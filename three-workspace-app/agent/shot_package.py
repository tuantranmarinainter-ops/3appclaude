"""Validate App 2 / App 3 shot packages without third-party dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import TypedDict


class Issue(TypedDict):
    code: str
    path: str
    message: str


class _Validator:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory).resolve()
        self.issues: list[Issue] = []

    def issue(self, code: str, path: str, message: str) -> None:
        self.issues.append({"code": code, "path": path, "message": message})

    def field(self, obj: dict, key: str, kind: type, path: str):
        location = f"{path}.{key}"
        if key not in obj:
            self.issue("MISSING_FIELD", location, "Required field is missing.")
            return None
        value = obj[key]
        valid = ((type(value) is int or (type(value) is float and math.isfinite(value)))
                 if kind is float else type(value) is kind)
        if not valid:
            self.issue("INVALID_TYPE", location, f"Expected {kind.__name__}.")
            return None
        if kind is str and not value.strip():
            self.issue("INVALID_VALUE", location, "Expected a non-empty string.")
            return None
        return value

    def version(self, obj: dict, path: str) -> None:
        value = self.field(obj, "version", str, path)
        if value is not None and not re.fullmatch(r"1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
            self.issue("UNSUPPORTED_VERSION", f"{path}.version", "Expected version 1.x.y.")

    def identifier(self, obj: dict, key: str, path: str):
        value = self.field(obj, key, str, path)
        if value is not None:
            try:
                if str(uuid.UUID(value)) != value:
                    raise ValueError("Non-canonical UUID")
            except ValueError:
                self.issue("INVALID_UUID", f"{path}.{key}", "Expected a lowercase hyphenated UUID.")
                return None
        return value

    def digest(self, obj: dict, key: str, path: str):
        value = self.field(obj, key, str, path)
        if value is not None and not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            self.issue("INVALID_SHA256", f"{path}.{key}", "Expected 64 hexadecimal characters.")
            return None
        return value.lower() if value is not None else None

    def file(self, obj: dict, key: str, path: str):
        value = self.field(obj, key, str, path)
        if value is None:
            return None
        posix, windows = PurePosixPath(value), PureWindowsPath(value)
        if (posix.is_absolute() or windows.drive or windows.root or "\\" in value
                or ".." in posix.parts or "\x00" in value):
            self.issue("UNSAFE_PATH", f"{path}.{key}", "Use a relative POSIX path inside the package, without '..'.")
            return None
        try:
            target = (self.directory / value).resolve()
            if not target.is_relative_to(self.directory):
                self.issue("UNSAFE_PATH", f"{path}.{key}", "Resolved path escapes the package (including symlinks).")
                return None
            if not target.is_file():
                self.issue("FILE_NOT_FOUND", f"{path}.{key}", f"Package file does not exist: {value}")
                return None
            return target
        except (OSError, ValueError, RuntimeError) as exc:
            self.issue("IO_ERROR", f"{path}.{key}", str(exc))
            return None

    def read_json(self, file: Path, path: str):
        try:
            # Python otherwise accepts NaN and Infinity, which are not JSON numbers.
            def reject_constant(value):
                raise ValueError(f"Non-JSON numeric constant: {value}")
            value = json.loads(file.read_text(encoding="utf-8"), parse_constant=reject_constant)
        except FileNotFoundError:
            self.issue("FILE_NOT_FOUND", path, "Package JSON file does not exist.")
            return None
        except (UnicodeError, ValueError) as exc:
            self.issue("INVALID_JSON", path, str(exc))
            return None
        except OSError as exc:
            self.issue("IO_ERROR", path, str(exc))
            return None
        if type(value) is not dict:
            self.issue("INVALID_TYPE", path, "Expected a JSON object.")
            return None
        return value

    def document(self, name: str):
        file = self.file({"file": name}, "file", name)
        return self.read_json(file, name) if file is not None else None

    def check_hash(self, file: Path | None, expected: str | None, path: str):
        if file is None or expected is None:
            return
        try:
            with file.open("rb") as stream:
                actual = hashlib.file_digest(stream, "sha256").hexdigest()
        except OSError as exc:
            self.issue("IO_ERROR", path, str(exc))
            return
        if actual != expected:
            self.issue("SHA256_MISMATCH", path, "SHA-256 does not match the referenced file bytes.")

    def vector(self, obj: dict, key: str, path: str, size: int = 3):
        value = self.field(obj, key, list, path)
        if value is not None and (len(value) != size or any(
                not (type(item) is int or (type(item) is float and math.isfinite(item))) for item in value)):
            self.issue("INVALID_VALUE", f"{path}.{key}", f"Expected {size} finite numbers.")
        return value

    def placement(self, obj: dict, path: str):
        self.vector(obj, "position", path)
        self.field(obj, "yawDegrees", float, path)

    def objects(self, obj: dict, key: str, path: str, *, nonempty: bool = False):
        values = self.field(obj, key, list, path)
        if values is None:
            return []
        if nonempty and not values:
            self.issue("INVALID_VALUE", f"{path}.{key}", "Expected at least one entry.")
        entries = []
        for index, value in enumerate(values):
            location = f"{path}.{key}[{index}]"
            if type(value) is not dict:
                self.issue("INVALID_TYPE", location, "Expected an object.")
            else:
                entries.append((value, location))
        return entries

    def keys(self, obj: dict, key: str, path: str, frame_range, *, camera: bool = False):
        previous = None
        for entry, location in self.objects(obj, key, path, nonempty=True):
            frame = self.field(entry, "frame", int, location)
            if frame is not None:
                if frame < 0 or (frame_range is not None and not frame_range[0] <= frame <= frame_range[1]):
                    self.issue("FRAME_OUT_OF_RANGE", f"{location}.frame", "Frame is outside the inclusive shot range.")
                if previous is not None and frame <= previous:
                    self.issue("KEYS_NOT_INCREASING", f"{location}.frame", "Frames must be strictly increasing.")
                previous = frame
            if camera:
                self.vector(entry, "position", location)
                self.vector(entry, "lookAt", location)
                fov = self.field(entry, "fovYDegrees", float, location)
                if fov is not None and not 0 < fov < 180:
                    self.issue("INVALID_VALUE", f"{location}.fovYDegrees", "Vertical FOV must be between 0 and 180 degrees.")
            else:
                self.placement(entry, location)

    def asset(self, obj: dict, path: str, action_key: str):
        glb = self.file(obj, "glb", path)
        digest = self.digest(obj, "glbSha256", path)
        self.check_hash(glb, digest, f"{path}.glbSha256")
        action = self.identifier(obj, action_key, path)
        manifest_file = self.file(obj, "manifest", path)
        if manifest_file is None:
            return
        manifest_path = f"{path}.manifest"
        manifest = self.read_json(manifest_file, manifest_path)
        if manifest is None:
            return
        self.version(manifest, manifest_path)
        manifest_digest = self.digest(manifest, "glbSha256", manifest_path)
        self.check_hash(glb, manifest_digest, f"{manifest_path}.glbSha256")
        uuids = set()
        for item, location in self.objects(manifest, "actions", manifest_path, nonempty=True):
            value = self.identifier(item, "uuid", location)
            if value is not None:
                if value in uuids:
                    self.issue("DUPLICATE_ACTION_UUID", f"{location}.uuid", "Action UUID is duplicated in the manifest.")
                uuids.add(value)
        if action is not None and action not in uuids:
            self.issue("ACTION_NOT_IN_MANIFEST", f"{path}.{action_key}", "Action UUID is absent from the referenced manifest.")

    def shot(self):
        shot = self.document("shot.json")
        if shot is None:
            return None, None
        path = "shot.json"
        self.version(shot, path)
        self.field(shot, "shotId", str, path)
        self.field(shot, "sceneId", str, path)
        fps = self.field(shot, "fps", int, path)
        if fps is not None and fps != 30:
            self.issue("INVALID_FPS", f"{path}.fps", "Shot FPS must be 30.")
        frames = self.field(shot, "frameRange", list, path)
        if frames is not None and (len(frames) != 2 or any(type(frame) is not int for frame in frames)
                                   or frames[0] < 0 or frames[1] < frames[0]):
            self.issue("INVALID_FRAME_RANGE", f"{path}.frameRange", "Expected [start, end] with integer 0 <= start <= end.")
            frames = None
        camera = self.field(shot, "camera", dict, path)
        if camera is not None:
            self.keys(camera, "keys", f"{path}.camera", frames, camera=True)
        character_ids = set()
        editable = False
        for character, location in self.objects(shot, "characters", path):
            character_id = self.field(character, "characterId", str, location)
            if character_id is not None:
                if character_id in character_ids:
                    self.issue("DUPLICATE_CHARACTER_ID", f"{location}.characterId", "Character ID is duplicated.")
                character_ids.add(character_id)
            editable = self.field(character, "editable", bool, location) is True or editable
            self.asset(character, location, "actionUuid")
            clip = self.field(character, "clip", dict, location)
            if clip is not None:
                clip_path = f"{location}.clip"
                start = self.field(clip, "sourceStartSeconds", float, clip_path)
                end = self.field(clip, "sourceEndSeconds", float, clip_path)
                speed = self.field(clip, "speed", float, clip_path)
                self.field(clip, "loop", bool, clip_path)
                self.field(clip, "reverse", bool, clip_path)
                if ((start is not None and start < 0) or (end is not None and end < 0)
                        or (start is not None and end is not None and end < start)
                        or (speed is not None and speed <= 0)):
                    self.issue("INVALID_CLIP", clip_path, "Clip requires 0 <= start <= end and speed > 0.")
            placement = self.field(character, "placement", dict, location)
            if placement is not None:
                self.placement(placement, f"{location}.placement")
            root = self.field(character, "rootPolicy", str, location)
            if root is not None and root not in {"skeletal", "in-place"}:
                self.issue("INVALID_ROOT_POLICY", f"{location}.rootPolicy", "Expected skeletal or in-place.")
        if not editable:
            self.issue("NO_EDITABLE_CHARACTER", f"{path}.characters", "At least one character must be editable.")
        for reference, location in self.objects(shot, "references", path):
            file = self.file(reference, "file", location)
            digest = self.digest(reference, "sha256", location)
            self.check_hash(file, digest, f"{location}.sha256")
            transform = self.field(reference, "transform", dict, location)
            if transform is not None:
                for key in ("position", "rotationDegrees", "scale"):
                    self.vector(transform, key, f"{location}.transform")
        return shot, frames


def validate_shot(directory: str | Path) -> list[Issue]:
    """Return all detected package issues; an empty list means valid."""
    validator = _Validator(directory)
    validator.shot()
    return validator.issues


def validate_result(directory: str | Path, shot_dir: str | Path) -> list[Issue]:
    """Validate a derivative package against the complete original shot package."""
    validator = _Validator(directory)
    base = _Validator(shot_dir)
    shot, frames = base.shot()
    validator.issues.extend({**issue, "path": f"shot/{issue['path']}"} for issue in base.issues)
    result = validator.document("result.json")
    if result is None:
        return validator.issues
    path = "result.json"
    validator.version(result, path)
    shot_id = validator.field(result, "shotId", str, path)
    digest = validator.digest(result, "baseShotSha256", path)
    if shot is not None:
        validator.check_hash(base.directory / "shot.json", digest, f"{path}.baseShotSha256")
        if shot_id is not None and shot_id != shot.get("shotId"):
            validator.issue("SHOT_ID_MISMATCH", f"{path}.shotId", "Shot ID does not match the original shot.")
    characters = {}
    if shot is not None and type(shot.get("characters")) is list:
        for item in shot["characters"]:
            if type(item) is dict and type(item.get("characterId")) is str:
                characters[item["characterId"]] = item
    seen = set()
    new_uuids = set()
    originals = {item.get("actionUuid") for item in characters.values() if type(item.get("actionUuid")) is str}
    for edit, location in validator.objects(result, "edits", path):
        character_id = validator.field(edit, "characterId", str, location)
        if character_id is not None:
            if character_id in seen:
                validator.issue("DUPLICATE_CHARACTER_ID", f"{location}.characterId", "Character is edited more than once.")
            seen.add(character_id)
        character = characters.get(character_id)
        if character_id is not None and shot is not None:
            if character is None:
                validator.issue("UNKNOWN_CHARACTER", f"{location}.characterId", "Character is absent from the shot.")
            elif character.get("editable") is not True:
                validator.issue("CHARACTER_NOT_EDITABLE", f"{location}.characterId", "Character is read-only in the shot.")
        original = validator.identifier(edit, "originalActionUuid", location)
        if original is not None and character is not None and original != character.get("actionUuid"):
            validator.issue("ORIGINAL_ACTION_MISMATCH", f"{location}.originalActionUuid", "Original UUID does not match the shot character's Action.")
        validator.asset(edit, location, "newActionUuid")
        new = edit.get("newActionUuid")
        if type(new) is str:
            if new == original or new in originals:
                validator.issue("ACTION_UUID_REUSED", f"{location}.newActionUuid", "A derivative must have a fresh UUID, preserving all original Actions.")
            if new in new_uuids:
                validator.issue("DUPLICATE_ACTION_UUID", f"{location}.newActionUuid", "Derivative UUID is reused by another edit.")
            new_uuids.add(new)
        validator.keys(edit, "placementKeys", location, frames)
    return validator.issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    shot = commands.add_parser("validate-shot")
    shot.add_argument("directory")
    result = commands.add_parser("validate-result")
    result.add_argument("directory")
    result.add_argument("--shot", required=True)
    args = parser.parse_args(argv)
    issues = (validate_shot(args.directory) if args.command == "validate-shot"
              else validate_result(args.directory, args.shot))
    print(json.dumps(issues, ensure_ascii=False, indent=2))
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
