"""Cài / gỡ gói phim BBS FS (ZIP xuất từ App 2) vào thư mục game — không cần Node hay project W01.

Cùng luật với App 2 (`apps/studio/src/bbsInstall.ts`, `bbsFilmRefs.ts`, `bbsWorldFilms.ts`):
- chỉ lấy `assets/**` -> `<game>/config/bbs/assets/**` và `films/*.dat` -> `<game>/saves/<world>/bbs/films/*.dat`;
- không ghi đè: file đã có cùng nội dung = bỏ qua, khác nội dung = xung đột (giữ nguyên file cũ);
- nhật ký chung `<game>/config/bbs/w01-install-log.json` (version 1) nên App 2 và tool này gỡ được phim của nhau;
- gỡ: chỉ xoá file còn đúng nội dung đã cài; asset mà phim khác còn dùng thì giữ lại (B64).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat as stat_mod
import subprocess
import unicodedata
import uuid
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

MAX_ZIP_BYTES = 128 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_ENTRIES = 4096
MAX_FILM_FILE = 128 * 1024 * 1024
LOG_REL = ('config', 'bbs', 'w01-install-log.json')
DEVICES = {'con', 'prn', 'aux', 'nul', 'conin$', 'conout$'} | {f'{p}{n}' for p in ('com', 'lpt') for n in (*range(1, 10), '¹', '²', '³')}
DEVICE_RE = re.compile(r'^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$', re.I)
MODEL_SUBFOLDERS = {'textures', 'animations', 'sounds'}


class InstallError(Exception):
    """Lỗi có thông báo tiếng Việt để hiện thẳng cho người dùng."""


# ------------------------------------------------------------------------------------------------ đường dẫn an toàn
def valid_world_name(value: str) -> bool:
    return bool(value) and value not in ('.', '..') and not re.search(r'[\\/:\0<>"|?*]', value) and not re.search(r'[ .]$', value) \
        and not DEVICE_RE.match(value)


def _inside(root: Path, candidate: Path) -> bool:
    r, c = os.path.normcase(str(root)), os.path.normcase(str(candidate))
    return c != r and c.startswith(r.rstrip('\\/') + os.sep)


def _is_link(p: Path) -> bool:
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return False
    # Junction trên Windows: reparse point (st_file_attributes có FILE_ATTRIBUTE_REPARSE_POINT = 0x400).
    return stat_mod.S_ISLNK(st.st_mode) or bool(getattr(st, 'st_file_attributes', 0) & 0x400)


def assert_safe(root: Path, target: Path, allow_missing: bool) -> None:
    """Đích phải nằm trong thư mục game, không đi qua symlink/junction."""
    target = Path(os.path.abspath(target))
    if not _inside(root, target):
        raise InstallError('Đường dẫn cài vượt ra ngoài thư mục game.')
    cursor = root
    parts = target.relative_to(root).parts
    for i, part in enumerate(parts):
        cursor = cursor / part
        if not os.path.lexists(cursor):
            if allow_missing:
                return
            raise InstallError(f'Không tìm thấy: {cursor}')
        if _is_link(cursor):
            raise InstallError(f'Đường dẫn có liên kết (symlink/junction), không cài vào đây: {cursor}')
        if i < len(parts) - 1 and not cursor.is_dir():
            raise InstallError(f'Thư mục cha không phải thư mục: {cursor}')


def canonical_game_dir(game_dir: str) -> Path:
    """Gốc game = thư mục chứa `mods` (tự đi lên tối đa 12 cấp, giống App 2); không có `mods` thì giữ nguyên."""
    if not game_dir or not game_dir.strip() or '\0' in game_dir:
        raise InstallError('Hãy chọn thư mục game BBS FS.')
    original = Path(os.path.realpath(game_dir.strip()))
    if not original.is_dir():
        raise InstallError('Thư mục game không tồn tại.')
    current = original
    for _ in range(12):
        if (current / 'mods').is_dir():
            return current
        if current.parent == current:
            break
        current = current.parent
    return original


def list_worlds(root: Path) -> list[str]:
    saves = root / 'saves'
    if not saves.is_dir() or _is_link(saves):
        return []
    rows = []
    for entry in saves.iterdir():
        if entry.is_dir() and not _is_link(entry) and valid_world_name(entry.name) and (entry / 'level.dat').is_file():
            rows.append(entry.name)
    return sorted(rows, key=str.casefold)


def world_dir(root: Path, world: str) -> Path:
    if not valid_world_name(world):
        raise InstallError('Tên world không hợp lệ.')
    folder = root / 'saves' / world
    assert_safe(root, folder / 'level.dat', False)
    if not (folder / 'level.dat').is_file():
        raise InstallError(f'World "{world}" không có level.dat.')
    return folder


# ------------------------------------------------------------------------------------------------ đọc gói ZIP
@dataclass
class PackageFile:
    name: str          # đường dẫn trong ZIP (assets/... hoặc films/x.dat)
    size: int
    sha256: str
    data: bytes


@dataclass
class Package:
    path: Path
    sha256: str
    files: list[PackageFile]
    requires_effects: bool
    required_mods: list[str]
    readme: str = ''

    @property
    def films(self) -> list[str]:
        return [f.name[len('films/'):] for f in self.files if f.name.startswith('films/')]

    @property
    def total_bytes(self) -> int:
        return sum(f.size for f in self.files)


def _check_member(raw: str, is_dir: bool) -> list[str]:
    if not raw or '\\' in raw or raw.startswith('/') or '\x00' in raw or any(ord(c) < 32 for c in raw):
        raise InstallError('Gói ZIP có đường dẫn không an toàn.')
    name = raw[:-1] if is_dir else raw
    parts = name.split('/')
    if not name or any(p in ('', '.', '..') for p in parts):
        raise InstallError('Gói ZIP có đường dẫn không an toàn.')
    for part in parts:
        normalized = unicodedata.normalize('NFC', part)
        stem = normalized.rstrip(' .').split('.')[0].casefold()
        if ':' in part or normalized.endswith(('.', ' ')) or stem in DEVICES:
            raise InstallError('Gói ZIP có tên file Windows không hợp lệ.')
    return parts


def _film_payload(data: bytes) -> bytes:
    """Phim BBS thường nén gzip/zlib; giải nén có giới hạn."""
    if data[:2] == b'\x1f\x8b' or (len(data) > 1 and data[0] == 0x78 and ((data[0] << 8) + data[1]) % 31 == 0):
        decoder = zlib.decompressobj(47)
        out = decoder.decompress(data, MAX_TOTAL + 1)
        if len(out) > MAX_TOTAL or decoder.unconsumed_tail:
            raise InstallError('Phim giải nén quá lớn.')
        return out
    return data


def read_package(zip_path: str) -> Package:
    path = Path(zip_path)
    if not path.is_file():
        raise InstallError('Không tìm thấy file ZIP.')
    size = path.stat().st_size
    if size < 22 or size > MAX_ZIP_BYTES:
        raise InstallError('File ZIP phải từ 22 byte đến 128 MB.')
    raw_bytes = path.read_bytes()
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise InstallError('File này không phải ZIP hợp lệ.') from error
    seen: set[str] = set()
    kinds: dict[str, str] = {}
    files: list[PackageFile] = []
    total = 0
    requires_effects = False
    required: list[str] = []
    readme = ''
    with archive:
        for info in archive.infolist():
            is_dir = info.is_dir()
            parts = _check_member(info.filename, is_dir)
            name = '/'.join(parts)
            key = unicodedata.normalize('NFC', name).casefold()
            if key in seen:
                raise InstallError('Gói ZIP có hai file trùng tên (khác hoa/thường).')
            seen.add(key)
            unix_mode = (info.external_attr >> 16) & 0o170000
            if unix_mode not in ((0, stat_mod.S_IFDIR) if is_dir else (0, stat_mod.S_IFREG)):
                raise InstallError('Gói ZIP chứa liên kết hoặc file đặc biệt.')
            if info.flag_bits & 1:
                raise InstallError('Gói ZIP có mật khẩu — không hỗ trợ.')
            if len(seen) > MAX_ENTRIES:
                raise InstallError('Gói ZIP có quá nhiều file.')
            total += info.file_size
            if total > MAX_TOTAL:
                raise InstallError('Gói ZIP giải nén quá lớn (trên 256 MB).')
            for i in range(1, len(parts)):
                prefix = '/'.join(parts[:i])
                if kinds.get(prefix) == 'file':
                    raise InstallError('Gói ZIP dùng file làm thư mục cha.')
                kinds[prefix] = 'dir'
            kind = 'dir' if is_dir else 'file'
            if kinds.get(name) and kinds[name] != kind:
                raise InstallError('Gói ZIP có file trùng tên thư mục.')
            kinds[name] = kind
            if is_dir:
                continue
            if name == 'required-mods.json':
                if info.file_size > 65536:
                    raise InstallError('required-mods.json quá lớn.')
                try:
                    req = json.loads(archive.read(info))
                except ValueError as error:
                    raise InstallError('required-mods.json không hợp lệ.') from error
                if not isinstance(req, dict):
                    raise InstallError('required-mods.json không hợp lệ.')
                required = [str(x) for x in req.get('requiredMods', []) if isinstance(x, (str, int, float))]
                requires_effects = requires_effects or bool(req.get('includedEffectCount', 0)) or any('AAA' in x for x in required)
            if name == 'README.txt' and info.file_size <= 65536:
                readme = archive.read(info).decode('utf8', 'replace')
            is_asset = name.startswith('assets/')
            is_film = len(parts) == 2 and parts[0] == 'films' and parts[1].lower().endswith('.dat')
            if not (is_asset or is_film):
                continue
            data = archive.read(info)
            if len(data) != info.file_size:
                raise InstallError('Một file trong ZIP bị đổi kích thước khi giải nén.')
            if name.startswith('assets/effeks/'):
                requires_effects = True
            if is_film and b'bbs:aaa_particle' in _film_payload(data):
                requires_effects = True
            files.append(PackageFile(name, len(data), hashlib.sha256(data).hexdigest(), data))
    if not files:
        raise InstallError('Gói ZIP không có phim (films/*.dat) hay tài nguyên (assets/**). Có phải gói xuất từ App 2 không?')
    return Package(path, hashlib.sha256(raw_bytes).hexdigest(), files, requires_effects, required, readme)


# ------------------------------------------------------------------------------------------------ kế hoạch cài
@dataclass
class PlanRow:
    source: str
    target: str            # tương đối với gốc game, dấu '/'
    size: int
    sha256: str
    status: str            # install | skip | conflict


@dataclass
class Plan:
    root: Path
    world: str
    package: Package
    rows: list[PlanRow] = field(default_factory=list)

    def count(self, status: str) -> int:
        return sum(1 for r in self.rows if r.status == status)


def _sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def _target_of(root: Path, world_folder: Path, name: str) -> Path:
    if name.startswith('assets/'):
        return root.joinpath('config', 'bbs', 'assets', *name[len('assets/'):].split('/'))
    return world_folder.joinpath('bbs', 'films', *name[len('films/'):].split('/'))


def plan_install(package: Package, root: Path, world: str) -> Plan:
    folder = world_dir(root, world)
    plan = Plan(root, world, package)
    for f in package.files:
        target = _target_of(root, folder, f.name)
        assert_safe(root, target, True)
        status = 'install'
        if os.path.lexists(target):
            status = 'skip' if target.is_file() and not _is_link(target) and _sha_file(target) == f.sha256 else 'conflict'
        rel = target.relative_to(root).as_posix()
        plan.rows.append(PlanRow(f.name, rel, f.size, f.sha256, status))
    return plan


# ------------------------------------------------------------------------------------------------ nhật ký cài
def _log_path(root: Path) -> Path:
    return root.joinpath(*LOG_REL)


def safe_owned_path(value: str) -> bool:
    parts = value.split('/')
    if any(not p or p in ('.', '..') or re.search(r'[\\:\0<>"|?*]', p) or re.search(r'[ .]$', p) or DEVICE_RE.match(p) for p in parts):
        return False
    if parts[:3] == ['config', 'bbs', 'assets'] and len(parts) >= 4:
        return True
    return len(parts) == 5 and parts[0] == 'saves' and valid_world_name(parts[1]) and parts[2:4] == ['bbs', 'films'] and parts[4].endswith('.dat')


def read_log(root: Path) -> dict:
    p = _log_path(root)
    assert_safe(root, p, True)
    if not p.exists():
        return {'version': 1, 'installs': []}
    if p.stat().st_size > 16 * 1024 * 1024:
        raise InstallError('Nhật ký cài quá lớn.')
    try:
        log = json.loads(p.read_text('utf8'))
    except ValueError as error:
        raise InstallError('Nhật ký cài (w01-install-log.json) bị hỏng.') from error
    if not isinstance(log, dict) or log.get('version') != 1 or not isinstance(log.get('installs'), list):
        raise InstallError('Nhật ký cài có định dạng lạ — không ghi đè để tránh mất dữ liệu.')
    for entry in log['installs']:
        if not isinstance(entry, dict) or not re.fullmatch(r'[0-9a-fA-F-]{36}', str(entry.get('installId', ''))) \
                or not isinstance(entry.get('ownedFiles'), list):
            raise InstallError('Nhật ký cài có định dạng lạ — không ghi đè để tránh mất dữ liệu.')
        for item in entry['ownedFiles']:
            if not isinstance(item, dict) or not safe_owned_path(str(item.get('path', ''))) or not re.fullmatch(r'[a-f0-9]{64}', str(item.get('sha256', ''))):
                raise InstallError('Nhật ký cài có dòng không an toàn.')
    return log


def write_log(root: Path, log: dict) -> None:
    p = _log_path(root)
    _ensure_dirs(root, p.parent)
    assert_safe(root, p, True)
    tmp = p.with_name(f'{p.name}.{uuid.uuid4()}.tmp')
    tmp.write_text(json.dumps(log, indent=2, ensure_ascii=False) + '\n', 'utf8')
    os.replace(tmp, p)


def _ensure_dirs(root: Path, folder: Path) -> None:
    folder = Path(os.path.abspath(folder))
    if folder != root and not _inside(root, folder):
        raise InstallError('Thư mục cài vượt ra ngoài thư mục game.')
    cursor = root
    for part in folder.relative_to(root).parts:
        cursor = cursor / part
        if not cursor.exists():
            cursor.mkdir()
        assert_safe(root, cursor, False)
        if not cursor.is_dir():
            raise InstallError(f'Không phải thư mục: {cursor}')


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


@dataclass
class InstallResult:
    install_id: str
    installed: list[str]
    skipped: list[str]
    conflicts: list[str]


def apply_install(plan: Plan) -> InstallResult:
    root = plan.root
    world_dir(root, plan.world)
    log = read_log(root)
    by_name = {f.name: f for f in plan.package.files}
    installed, skipped, conflicts, owned, created = [], [], [], [], []
    try:
        for row in plan.rows:
            target = root.joinpath(*row.target.split('/'))
            assert_safe(root, target, True)
            data = by_name[row.source].data
            if hashlib.sha256(data).hexdigest() != row.sha256:
                raise InstallError('Nội dung gói đổi sau khi xem trước.')
            if os.path.lexists(target):
                same = target.is_file() and not _is_link(target) and _sha_file(target) == row.sha256
                (skipped if same else conflicts).append(row.target)
                continue
            _ensure_dirs(root, target.parent)
            assert_safe(root, target, True)
            try:
                with open(target, 'xb') as out:
                    out.write(data)
            except FileExistsError:
                conflicts.append(row.target)
                continue
            created.append((target, row.sha256))
            owned.append({'path': row.target, 'sha256': row.sha256})
            installed.append(row.target)
        install_id = str(uuid.uuid4())
        log['installs'].append({'installId': install_id, 'installedAt': _now(), 'packageName': plan.package.path.name[:160],
                                'packageSha256': plan.package.sha256, 'ownedFiles': owned})
        write_log(root, log)
        return InstallResult(install_id, installed, skipped, conflicts)
    except Exception:
        for target, sha in reversed(created):
            try:
                if _sha_file(target) == sha:
                    target.unlink()
            except OSError:
                pass  # Không chắc là file của mình thì giữ lại.
        raise


# ------------------------------------------------------------------------------------------------ gỡ
def _bytes_text(value: str) -> str:
    return value.encode('utf8').decode('latin1').lower()


def asset_reference_key(relative: str) -> str:
    """Chuỗi mà một phim phải chứa thì asset (đường dẫn trong config/bbs/assets) mới còn được dùng (giống bbsFilmRefs.ts)."""
    parts = [p for p in relative.split('/') if p]
    head = parts[0].lower() if parts else ''
    if head == 'models' and len(parts) >= 3:
        folders = parts[1:-1]
        cut = next((i for i, p in enumerate(folders) if p.lower() in MODEL_SUBFOLDERS), -1)
        ident = (folders[:cut] if cut >= 0 else folders)[:2]
        if ident:
            return _bytes_text('/'.join(ident))
    if head == 'effeks' and len(parts) >= 3:
        return _bytes_text('/'.join(parts[:2]))
    return _bytes_text('/'.join(parts))


def _contains_key(text: str, key: str) -> bool:
    if not key:
        return True
    at = text.find(key)
    while at >= 0:
        if at == 0:
            return True
        before = ord(text[at - 1])
        if before in (0x2F, 0x3A) or before < 0x20 or at == 1 or ord(text[at - 2]) < 0x20:
            return True
        at = text.find(key, at + 1)
    return False


class FilmIndex:
    """Mọi phim còn lại trong mọi world; đọc không được phim nào thì coi như asset nào cũng còn dùng."""

    def __init__(self, root: Path):
        self.texts: list[str] = []
        self.unreadable = False
        saves = root / 'saves'
        if not saves.is_dir() or _is_link(saves):
            return
        for world in saves.iterdir():
            folder = world / 'bbs' / 'films'
            if not world.is_dir() or _is_link(world) or _is_link(world / 'bbs') or not folder.is_dir() or _is_link(folder):
                continue
            for film in folder.iterdir():
                if not film.name.lower().endswith('.dat'):
                    continue
                try:
                    if _is_link(film) or not film.is_file() or film.stat().st_size > MAX_FILM_FILE:
                        self.unreadable = True
                        continue
                    self.texts.append(_film_payload(film.read_bytes()).decode('latin1').lower())
                except (OSError, InstallError, zlib.error):
                    self.unreadable = True

    def is_referenced(self, relative_asset: str) -> bool:
        if self.unreadable:
            return True
        key = asset_reference_key(relative_asset)
        return any(_contains_key(t, key) for t in self.texts)


def _remove_logged(root: Path, item: dict) -> bool:
    target = root.joinpath(*item['path'].split('/'))
    try:
        assert_safe(root, target, False)
        if _is_link(target) or not target.is_file() or _sha_file(target) != item['sha256']:
            return False
        target.unlink()
        return True
    except (OSError, InstallError):
        return False


@dataclass
class InstallRecord:
    install_id: str
    installed_at: str
    package_name: str
    files: list[dict]

    @property
    def films(self) -> list[str]:
        return [f['path'].split('/')[-1] for f in self.files if f['path'].startswith('saves/')]

    @property
    def world(self) -> str:
        return next((f['path'].split('/')[1] for f in self.files if f['path'].startswith('saves/')), '')


def list_installs(root: Path) -> list[InstallRecord]:
    rows = [InstallRecord(e['installId'], str(e.get('installedAt', '')), str(e.get('packageName', '')), e['ownedFiles'])
            for e in read_log(root)['installs'] if not e.get('uninstalledAt')]
    return sorted(rows, key=lambda r: r.installed_at, reverse=True)


@dataclass
class UninstallResult:
    removed: list[str]
    preserved: list[str]
    in_use: list[str]


def uninstall(root: Path, install_id: str) -> UninstallResult:
    log = read_log(root)
    entry = next((e for e in log['installs'] if e['installId'] == install_id and not e.get('uninstalledAt')), None)
    if not entry:
        raise InstallError('Không tìm thấy lần cài này (có thể đã gỡ).')
    removed, preserved, in_use = [], [], []
    for item in [f for f in entry['ownedFiles'] if not f['path'].startswith('config/bbs/assets/')]:
        (removed if _remove_logged(root, item) else preserved).append(item['path'])
    index = FilmIndex(root)
    heirs = sorted((e for e in log['installs'] if not e.get('uninstalledAt') and e['installId'] != install_id),
                   key=lambda e: str(e.get('installedAt', '')), reverse=True)
    for item in [f for f in entry['ownedFiles'] if f['path'].startswith('config/bbs/assets/')]:
        if index.is_referenced(item['path'][len('config/bbs/assets/'):]):
            in_use.append(item['path'])
            if heirs:
                heirs[0]['ownedFiles'].append(item)  # Phim khác còn dùng: chuyển quyền sở hữu, không xoá.
            else:
                preserved.append(item['path'])
        else:
            (removed if _remove_logged(root, item) else preserved).append(item['path'])
    entry['uninstalledAt'] = _now()
    entry['preservedFiles'] = preserved
    write_log(root, log)
    return UninstallResult(removed, preserved, in_use)


# ------------------------------------------------------------------------------------------------ mod + game đang mở
MOD_SCAN_MAX = 64 * 1024 * 1024


def _inspect_jar(source, label: str, rows: list[dict], budget: list[int], depth: int = 0) -> None:
    if depth > 3:
        return
    with zipfile.ZipFile(source) as z:
        names = z.namelist()
        if len(names) > 10000:
            return

        def read(name: str) -> bytes:
            info = z.getinfo(name)
            if info.file_size > 8 * 1024 * 1024 or budget[0] + info.file_size > MOD_SCAN_MAX:
                raise ValueError('metadata too large')
            budget[0] += info.file_size
            return z.read(info)

        if 'fabric.mod.json' in names:
            meta = json.loads(read('fabric.mod.json').decode('utf8', 'replace'), strict=False)
            rows.append({'id': str(meta.get('id', '')), 'version': str(meta.get('version', '')), 'file': label})
        if 'META-INF/mods.toml' in names:
            text = read('META-INF/mods.toml').decode('utf8', 'replace')
            for block in text.split('[[mods]]')[1:]:
                ident = re.search(r'modId\s*=\s*["\']([^"\']+)', block)
                version = re.search(r'version\s*=\s*["\']([^"\']+)', block)
                if ident:
                    rows.append({'id': ident.group(1), 'version': version.group(1) if version else '', 'file': label})
        for name in names:
            if name.startswith('META-INF/jars/') and name.endswith('.jar'):
                import io
                _inspect_jar(io.BytesIO(read(name)), label + '!' + name, rows, budget, depth + 1)


def scan_mods(root: Path) -> list[dict]:
    """Đọc metadata trong mods/*.jar (kể cả jar lồng), không đoán theo tên file."""
    rows: list[dict] = []
    mods = root / 'mods'
    if not mods.is_dir():
        return rows
    budget = [0]
    for jar in sorted(mods.iterdir())[:1024]:
        if jar.suffix.lower() != '.jar' or _is_link(jar) or not jar.is_file():
            continue
        try:
            _inspect_jar(jar, jar.name, rows, budget)
        except Exception:  # noqa: BLE001 — jar hỏng thì bỏ qua, giống App 2
            continue
    return rows


@dataclass
class ModCheck:
    ok: bool
    lines: list[tuple[bool | None, str]]   # (đạt? / None = chưa chắc, mô tả)


REQUIRED_MC = '1.20.1'
MC_IN_TEXT = re.compile(r'(?<![\d.])1\.(\d{1,2})(?:\.(\d{1,2}))?(?![\d.])')


def minecraft_version(root: Path, rows: list[dict]) -> str | None:
    """Phiên bản Minecraft của thư mục game: thư mục versions/, rồi đuôi phiên bản BBS ("2.7-1.20.1"), rồi đa số tên jar trong mods."""
    def found(text: str) -> str | None:
        m = MC_IN_TEXT.search(text)
        return m.group(0) if m else None
    versions = root / 'versions'
    if versions.is_dir():
        names = {v for v in (found(p.name) for p in versions.iterdir() if p.is_dir()) if v}
        if len(names) == 1:
            return names.pop()
        if REQUIRED_MC in names:
            return REQUIRED_MC
    bbs = next((m for m in rows if m['id'] in ('bbs', 'bbs_mod')), None)
    if bbs and '-' in bbs['version']:
        hit = found(bbs['version'].split('-', 1)[1])
        if hit:
            return hit
    votes: dict[str, int] = {}
    mods = root / 'mods'
    if mods.is_dir():
        for jar in mods.iterdir():
            if jar.suffix.lower() == '.jar':
                hit = found(jar.stem)
                if hit:
                    votes[hit] = votes.get(hit, 0) + 1
    return max(votes, key=votes.get) if votes else None


def check_mods(root: Path, package: Package) -> ModCheck:
    rows = scan_mods(root)
    find = lambda ids: next((m for m in rows if m['id'] in ids), None)  # noqa: E731
    lines: list[tuple[bool | None, str]] = []
    mc = minecraft_version(root, rows)
    if mc == REQUIRED_MC:
        lines.append((True, f'Minecraft {mc}'))
    elif mc:
        lines.append((False, f'Game là Minecraft {mc} — phim BBS FS 2.7 cần Minecraft {REQUIRED_MC}'))
    else:
        lines.append((None, f'Chưa xác định được phiên bản game — cần Minecraft {REQUIRED_MC}'))
    bbs = find(('bbs', 'bbs_mod'))
    if bbs and re.match(r'^2\.7(?:[.\-+]|$)', bbs['version']):
        lines.append((True, f'BBS FS {bbs["version"]}'))
    elif bbs:
        lines.append((False, f'BBS FS {bbs["version"] or "?"} — cần bản 2.7'))
    else:
        lines.append((False, 'Chưa có mod BBS FS 2.7 trong thư mục mods'))
    if package.requires_effects:
        aaa, addon = find(('aaa_particles',)), find(('bbs-aaaddon',))
        lines.append((bool(aaa), f'AAA Particles {aaa["version"]}' if aaa else 'Phim có hiệu ứng nhưng chưa có mod AAA Particles (game có thể sập)'))
        lines.append((bool(addon), f'Addon BBS–AAA {addon["version"]}' if addon else 'Phim có hiệu ứng nhưng chưa có addon BBS–AAA (bbs-aaaddon)'))
    return ModCheck(all(ok is not False for ok, _ in lines), lines)


def game_running(root: Path) -> tuple[bool, bool]:
    """(đang chạy đúng thư mục game này, có Minecraft khác đang chạy). Hỏi Windows qua PowerShell; lỗi thì coi như không chạy."""
    if os.name != 'nt':
        return False, False
    script = "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' or Name='java.exe'\" | ForEach-Object { $_.CommandLine }"
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, text=True,
                             timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), encoding='utf8', errors='replace').stdout
    except (OSError, subprocess.TimeoutExpired):
        return False, False
    norm = lambda s: s.replace('/', '\\').casefold().rstrip('\\')  # noqa: E731
    game = norm(str(root))
    this = other = False
    for line in out.splitlines():
        text = norm(line)
        if not text:
            continue
        if game in text:
            this = True
        elif 'minecraft' in text or 'net.minecraft' in text:
            other = True
    return this, other


# ------------------------------------------------------------------------------------------------ tiện ích UI
def human_size(n: int) -> str:
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return f'{n:.0f} {unit}' if unit == 'B' else f'{n:.1f} {unit}'
        n /= 1024
    return f'{n} B'


def guess_game_dirs() -> list[str]:
    """Gợi ý thư mục game hay gặp (Minecraft gốc, CurseForge, Prism, TLauncher...)."""
    home, appdata = Path.home(), Path(os.environ.get('APPDATA', ''))
    candidates = [appdata / '.minecraft', home / 'curseforge' / 'minecraft' / 'Instances', appdata / 'PrismLauncher' / 'instances',
                  appdata / '.tlauncher' / 'legacy' / 'Minecraft' / 'game']
    found = []
    for c in candidates:
        if (c / 'mods').is_dir():
            found.append(str(c))
        elif c.is_dir():
            for sub in sorted(c.iterdir())[:50]:
                for inner in (sub, sub / 'minecraft', sub / '.minecraft'):
                    if (inner / 'mods').is_dir():
                        found.append(str(inner))
    return found

