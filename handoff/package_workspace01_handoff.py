"""Package the current source and documentation without changing application files."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import zipfile

ROOT = next(parent for parent in Path(__file__).resolve().parents
            if (parent / 'three-workspace-app/editor/package.json').is_file())
OUT = ROOT / 'docs/three-workspace-app/exports'
OUT.mkdir(parents=True, exist_ok=True)
STAMP = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
DEST = OUT / f'WORKSPACE_1_CODE_PROGRESS_{STAMP}.zip'
PARTIAL = DEST.with_suffix('.zip.partial')
EXCLUDED_DIRS = {
    'node_modules', 'dist', 'out', 'coverage', '__pycache__', '.pytest_cache',
    '.git', '.agents', '.claude-plugin', '.codex-plugin', '.cursor-plugin',
    '.pnpm-store', '.turbo', 'unified-projects', 'drafts', '_runtime',
    'next-build', 'build', '.logs', '.mvp-runtime', '.test-runtime',
    '.film-ui-smoke-data', 'exports', '.venv', '.idea', '.vscode',
}
EXCLUDED_PREFIXES = ('three-workspace-app/docs/assets/',)
SECRET_PATTERNS = [
    re.compile(rb'apikey_[a-fA-F0-9]{24,}'),
    re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(rb'AKIA[A-Z0-9]{16}'),
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def collect():
    result = []
    for folder in (ROOT / 'three-workspace-app', ROOT / 'docs/three-workspace-app'):
        for here, dirs, files in os.walk(folder, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS
                             and not d.startswith(('.next', '.venv'))
                             and not (Path(here) / d).is_symlink()
                             and not (Path(here) / d).is_junction())
            for name in sorted(files):
                path = Path(here) / name
                rel = path.relative_to(ROOT).as_posix()
                if path.is_symlink() or rel.startswith(EXCLUDED_PREFIXES):
                    continue
                if (name.startswith('.env') and name != '.env.example'
                        or name in {'.npmrc', '.pypirc', '.mcp.json', '.DS_Store'}
                        or name.endswith(('.log', '.tsbuildinfo', '.pyc', '.pyo', '.zip', '.partial'))
                        or name.startswith('~$')):
                    continue
                result.append((rel, path))
    return sorted(result)


files = collect()
required = [
    'three-workspace-app/editor/packages/retarget/src/universal.ts',
    'three-workspace-app/editor/packages/retarget/test/universal.test.ts',
    'three-workspace-app/editor/packages/shared/src/index.ts',
    'three-workspace-app/editor/apps/studio/app/workbench/components/normalization/MappingEditor.tsx',
    'three-workspace-app/editor/apps/studio/src/unifiedNormalizationPlan.ts',
    'three-workspace-app/editor/pnpm-lock.yaml',
    'three-workspace-app/agent/unified_cli.py',
    'three-workspace-app/agent/unified_mcp.py',
    'three-workspace-app/builtin-assets/manifest.json',
    'docs/three-workspace-app/LISTCODE',
    'docs/three-workspace-app/docs/evidence/workspace01-doc116-validation.yaml',
    'docs/three-workspace-app/docs/inventory/workspace01-remaining.yaml',
]
paths = {rel for rel, _ in files}
if missing := set(required) - paths:
    raise RuntimeError(f'Missing required package content: {sorted(missing)}')

inventory = (ROOT / 'docs/three-workspace-app/docs/inventory/workspace01-remaining.yaml').read_text(encoding='utf-8-sig')
tasks = []
for block in inventory.split('\n- id: ')[1:]:
    task = {'id': block.splitlines()[0].strip()}
    for field in ('name', 'phase', 'implementation', 'work_type', 'runtime_acceptance'):
        match = re.search(rf'^  {field}: (.+)$', block, re.M)
        task[field] = match.group(1).strip() if match else 'unknown'
    tasks.append(task)
if len(tasks) != 17:
    raise RuntimeError('Inventory changed: review the handoff summary before packaging')

readme = '''# Bàn giao Workspace 1 — Code và progress

Đây là ảnh chụp mã nguồn trên đĩa và hồ sơ tiến độ của Workspace 1 (Universal Rig & Animation Normalization). Giữ nguyên cả phần triển khai dở. Không phải bộ cài, bản production hoặc một ứng dụng đã tách độc lập.

## Đọc theo thứ tự

1. `handoff/PROGRESS.md`: tiến độ tổng hợp và các giới hạn hiện hành.
2. `handoff/CHECKPOINT.json`: mốc bàn giao và danh sách 17 đầu việc có cấu trúc.
3. `docs/three-workspace-app/docs/features/rig-animation-normalization.md`: đặc tả tổng thể.
4. `docs/three-workspace-app/docs/features/workspace01-remaining.md`: đặc tả phần còn thiếu.
5. `docs/three-workspace-app/LISTCODE` và `docs/inventory/workspace01-remaining.yaml` bên trong thư mục tài liệu tương ứng.
6. `docs/three-workspace-app/docs/STATUS.md`, `CHECKPOINTS.md`, `HISTORY.md` và `evidence/workspace01-doc116-validation.yaml`.

## Phạm vi code

Workspace 1 hiện phụ thuộc host và các package của app ba workspace. Vì vậy gói giữ trọn source app và các phụ thuộc nội bộ, bao gồm những phần Scene/Animation liên quan, để không cắt đứt import hoặc pnpm workspace. Đây là bàn giao source có bản đồ phạm vi Workspace 1, chưa thực hiện refactor tách sản phẩm.

| Vị trí | Vai trò |
| --- | --- |
| `three-workspace-app/editor/packages/retarget/src/` | Universal solver, mapping/preset, calibration, sampler, bake/export, skin, Assignment và tương thích V9.12 |
| `three-workspace-app/editor/packages/retarget/test/` | Tests thuật toán, mapping, GLB, skin, Assignment và catalogue 85 |
| `three-workspace-app/editor/apps/studio/app/workbench/components/normalization/` | UI nhập/chọn rig, RigTree, MappingEditor, NormalizationPreview, ModelRebindPanel, AssignmentPanel |
| `three-workspace-app/editor/apps/studio/src/` | API/command broker, project store, rig inspection, normalization plan/job, asset import và history |
| `three-workspace-app/editor/apps/studio/app/api/` | Các route API local |
| `three-workspace-app/editor/apps/studio/test/` | Integration tests, lưu/mở/history, normalization, skin và Assignment |
| `three-workspace-app/editor/packages/shared/` | Hợp đồng project, Asset/Character/Skeleton/Mapping/Motion và validation |
| `three-workspace-app/editor/packages/builder/` | Phụ thuộc Topview: scene, engine, evaluation, playback và giao diện |
| `three-workspace-app/editor/packages/director-cli/` | Hỗ trợ Node renderer/CLI của host |
| `three-workspace-app/agent/` | Python CLI/MCP, tests và các worker đi kèm source app |
| `three-workspace-app/builtin-assets/` | Model canonical, pose, manifest và license/NOTICE |
| `three-workspace-app/editor/apps/studio/public/` | Các artifact trình duyệt được source host sử dụng |
| `docs/three-workspace-app/` | Đặc tả, LISTCODE, inventory, schema, báo cáo, lịch sử và evidence |

## Khôi phục môi trường phát triển

Giải nén và giữ nguyên cấu trúc thư mục tương đối. Cần Node.js, pnpm và Python 3.11 trở lên. Kiểm thử `.ts` trực tiếp bằng `--experimental-strip-types` trong lượt bàn giao sử dụng Node đã cài trên máy; trên máy khác có thể cần Node tương thích hoặc runner TypeScript của project.

Từ `three-workspace-app/editor`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Theo scripts hiện có, lệnh dev build Builder trước rồi mở Studio local tại `http://127.0.0.1:3002`. Không coi các lệnh này là đã được chạy lại thành công sau giải nén. Cài dependency có thể cần mạng; `node_modules` không nằm trong gói. `.env.example` được giữ; `.env.local` không được mang sang. Built-in assets dùng vị trí mặc định trong source app hoặc cấu hình local trên máy nhận.

Các kiểm tra của source, chạy tuần tự để tránh đụng build output:

```powershell
pnpm typecheck
pnpm lint
pnpm test:evaluate
pnpm build
```

Chỉ chạy offline smoke khi Studio production build thành công. Từ `three-workspace-app`, kiểm Python CLI/MCP bằng:

```powershell
python -m unittest agent.test_unified_cli agent.test_unified_mcp
```

Hướng dẫn CLI nghiệp vụ nằm tại `docs/three-workspace-app/docs/NORMALIZATION_CLI.md`.

## Giới hạn và phần loại khỏi ZIP

- Không chứa `node_modules`, runtime cài sẵn, cache, output build và log.
- Không chứa project/draft dữ liệu người dùng, cấu hình bí mật, `.env.local`, `.npmrc`, thư mục Git hoặc cấu hình agent cá nhân. Root AGENTS của workspace chứa credential nên không đưa vào gói; chỉ giữ các AGENTS của source/tài liệu được kiểm tra.
- Không chứa video quảng bá tại `three-workspace-app/docs/assets` và các ZIP xuất trước đó. Các tài nguyên model/pose, source fixtures và license được giữ.
- Các đường dẫn tuyệt đối hoặc tham chiếu source lịch sử bên ngoài hai cây thư mục đã đóng gói vẫn là thông tin truy nguyên trên máy gốc. Không đóng gói các checkout mod/BBS/Blender, fixture ngoài hoặc toolchain bên ngoài đó.
- Không sửa lỗi, chạy game, publish hay khởi động lại goal code trong lượt bàn giao này. Các hồ sơ cũ giữ nguyên lịch sử; dùng DOC-116 cùng `handoff/PROGRESS.md` để hiểu mốc bàn giao.

`handoff/MANIFEST.json` ghi kích thước và SHA-256 của mọi file được đóng gói trừ chính manifest. Khi tạo ZIP, từng entry được đọc lại và đối chiếu hash; tính toàn vẹn archive được kiểm bằng CRC.
'''

progress = '''# Workspace 1 — Progress bàn giao

## Mốc mới nhất được đối chiếu

DOC-116 ngày 2026-10-20 ghi nhận sửa lỗi quaternion trong local-compose, thêm kiểm thử hai topology nguồn về canonical Mixamo65 và kiểm tra Assignment chỉ tác động Character C. Các thay đổi này có trên source đang đóng gói. Thông báo FAIL ở lần dừng trước đã được thay thế bằng bằng chứng mới này.

Lượt đóng gói chỉ chạy lại một test tập trung:

`node --experimental-strip-types --test --test-name-pattern='local chain composition' packages/retarget/test/universal.test.ts`

Kết quả: **1 PASS, 0 FAIL**. Không chạy lại toàn bộ suite, production build, browser hoặc game trong lượt đóng gói.

## Bằng chứng trong DOC-116 — không phải tất cả được chạy lại lúc đóng gói

| Nhóm | Kết quả đã ghi |
| --- | --- |
| Retarget package | 59 PASS |
| Studio normalization/import tập trung | 33 PASS, 1 SKIP |
| Python CLI/MCP | 47 PASS |
| Builder evaluate | 557 PASS, 1 SKIP |
| Workspace typecheck | PASS khi chạy tuần tự sau Builder build |
| Lint và locale | PASS |
| Production build | Builder đạt; Studio Next bị EPERM scandir AppData/Local/Application Data |
| Offline smoke | Chưa có lượt hợp lệ sau production build thành công |
| Rig thật CC/UE, browser/WebGL và game của W01 | Chưa xác minh |

## Cách đọc tiến độ

Inventory phần bổ sung vẫn ghi **0/17 task hoàn tất**, gồm 15 task code/kiểm tra và 2 task fixture/runtime. **0/8 gate nghiệm thu** được chấp nhận. Những con số này đo việc đóng trọn task/gate, không phải tỷ lệ số dòng code đã viết. Nhiều phần có code và bằng chứng tự động nhưng chưa đạt toàn bộ điều kiện đóng mục.

Code gồm import/inspect nhiều skeleton, identity, diagnostics Action, budget, mapping 65 joint, chain weighting, reference/calibration, plan/job/report, GLB derivative, skin transfer/rebind, Assignment và history. Local-compose có sửa solver và regression PASS; không suy ra toàn bộ schema, UI, preset, metrics và runtime của task đó đã đồng bộ hoàn chỉnh. Có thể còn khác biệt giữa các lớp; giữ nguyên source để người nhận kiểm tra theo đặc tả.

## Danh sách bàn giao theo inventory

| ID | Nội dung | Trạng thái implementation trong inventory |
| --- | --- | --- |
'''
for task in tasks:
    progress += f"| {task['id']} | {task['name']} | {task['implementation']} |\n"
progress += '''
## Điểm cần biết khi tiếp nhận

- RigGraph nguồn linh hoạt không đồng nghĩa tất cả native format hoặc topology đều được chuyển lossless.
- Chưa có kết luận runtime đa nguồn thực và chưa nghiệm thu toàn bộ Workspace 1.
- Production build đang có lỗi môi trường/tracing đã ghi; gói source không phải executable chạy ngay.
- Đối chiếu `workspace01-remaining.md` và LISTCODE trước khi tiếp tục; không lấy các bằng chứng Animation Creation/Film của workspace khác làm bằng chứng W01.
- Lượt bàn giao không cấp phép khởi động lại việc code, game, commit hoặc phát hành. Phạm vi lượt này là đóng gói code và tiến độ hiện có.
'''

checkpoint = {
    'type': 'workspace01-source-handoff', 'captured_at': datetime.now(timezone.utc).isoformat(),
    'source_checkpoint': 'DOC-116', 'code_modified_during_packaging': False,
    'package_kind': 'source_snapshot_with_shared_app_dependencies_not_standalone_release',
    'progress': {'remaining_tasks_total': 17, 'code_and_check_tasks': 15, 'fixture_runtime_tasks': 2,
                 'completed_remaining_tasks': 0, 'accepted_gates': 0, 'total_gates': 8},
    'packaging_test': {'name': 'local chain composition', 'passed': 1, 'failed': 0},
    'historical_checks_source': 'docs/three-workspace-app/docs/evidence/workspace01-doc116-validation.yaml',
    'tasks': tasks,
}
generated = {
    'README_BAN_GIAO.md': readme.encode('utf-8'),
    'handoff/PROGRESS.md': progress.encode('utf-8'),
    'handoff/CHECKPOINT.json': json.dumps(checkpoint, ensure_ascii=False, indent=2).encode('utf-8'),
    'handoff/package_workspace01_handoff.py': Path(__file__).read_bytes(),
}
# Keep the requested standalone product description alongside the actual source handoff.
description = OUT / 'workspace01-standalone/MO_TA_UNG_DUNG_CHUAN_HOA_RIG_ANIMATION.md'
if not description.exists():
    description = ROOT / 'handoff/MO_TA_UNG_DUNG_CHUAN_HOA_RIG_ANIMATION.md'
if description.exists():
    generated['handoff/MO_TA_UNG_DUNG_CHUAN_HOA_RIG_ANIMATION.md'] = description.read_bytes()

manifest = []
source_fingerprints = []
with zipfile.ZipFile(PARTIAL, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for rel, path in files:
        before = path.stat()
        data = path.read_bytes()
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError(f'Source changed while reading: {rel}')
        if any(pattern.search(data) for pattern in SECRET_PATTERNS):
            raise RuntimeError(f'Credential-like content requires review before packaging: {rel}')
        archive.writestr(rel, data)
        file_hash = digest(data)
        manifest.append({'path': rel, 'bytes': len(data), 'sha256': file_hash})
        source_fingerprints.append((path, file_hash))
    for rel, data in generated.items():
        archive.writestr(rel, data)
        manifest.append({'path': rel, 'bytes': len(data), 'sha256': digest(data)})
    archive.writestr('handoff/MANIFEST.json', json.dumps({
        'schema_version': 1, 'created_at': checkpoint['captured_at'],
        'manifest_excludes_itself': True, 'files': manifest,
    }, ensure_ascii=False, indent=2).encode('utf-8'))

for path, file_hash in source_fingerprints:
    if digest(path.read_bytes()) != file_hash:
        raise RuntimeError(f'Source changed during snapshot: {path.relative_to(ROOT)}')
with zipfile.ZipFile(PARTIAL) as archive:
    names = archive.namelist()
    if len(names) != len(set(name.casefold() for name in names)):
        raise RuntimeError('Duplicate archive entries')
    if any(name.startswith('/') or '..' in Path(name).parts for name in names):
        raise RuntimeError('Unsafe archive path')
    if bad_entry := archive.testzip():
        raise RuntimeError(f'CRC failed: {bad_entry}')
    for item in manifest:
        data = archive.read(item['path'])
        if len(data) != item['bytes'] or digest(data) != item['sha256']:
            raise RuntimeError(f'Archive hash failed: {item["path"]}')
PARTIAL.rename(DEST)
print(json.dumps({'archive': str(DEST), 'source_files': len(files),
                  'entries': len(manifest) + 1, 'archive_bytes': DEST.stat().st_size,
                  'sha256': digest(DEST.read_bytes()), 'verification': 'CRC and all file hashes PASS; source unchanged'},
                 ensure_ascii=False, indent=2))
