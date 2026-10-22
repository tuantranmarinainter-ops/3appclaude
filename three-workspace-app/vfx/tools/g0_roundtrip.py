"""G0: open -> edit -> save -> reopen an Effekseer document, each step in a fresh process.

Usage (Windows, EFFEKSEER_AI_BIN_DIR set):
    python tools/g0_roundtrip.py <source.efkefc> <work_dir>

The source is copied into work_dir; the source file itself is never modified.
Prints a JSON report and exits non-zero if any check fails.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

CLI = [sys.executable, "-m", "effekseer_ai.cli"]
EDIT_NODE = "node/root/4"
EDIT_PROPERTY = f"{EDIT_NODE}/CommonValues/MaxGeneration/Value/Value"
RENAME_NODE = "node/root/0"
NEW_NAME = "G0Renamed"


def run(*args: str) -> object:
    result = subprocess.run([*CLI, *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed:\n{result.stderr}")
    return json.loads(result.stdout)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    source, work_dir = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    effect = work_dir / "g0_edit.efkefc"
    shutil.copy2(source, effect)
    source_hash = sha256(source)

    before_nodes = run("node-list", str(effect))
    before_value = run("property-get", str(effect), EDIT_PROPERTY)
    new_value = int(before_value) + 7

    run("property-set", str(effect), EDIT_PROPERTY, json.dumps(new_value))
    run("node-rename", str(effect), RENAME_NODE, NEW_NAME)

    # Reopen in fresh processes: Core state is per process.
    after_nodes = run("node-list", str(effect))
    after_value = run("property-get", str(effect), EDIT_PROPERTY)
    exported = Path(run("export", str(effect), str(work_dir / "g0_edit.efk"))["path"])

    expected_nodes = [dict(n) for n in before_nodes]
    expected_nodes[0]["name"] = NEW_NAME
    checks = {
        "value_persisted": after_value == new_value,
        "rename_persisted": after_nodes[0]["name"] == NEW_NAME,
        "other_nodes_unchanged": after_nodes == expected_nodes,
        "source_untouched": sha256(source) == source_hash,
        "export_nonempty": exported.stat().st_size > 0,
    }
    report = {
        "source": str(source),
        "effect": str(effect),
        "edit": {"property": EDIT_PROPERTY, "before": before_value, "after": after_value},
        "rename": {"node": RENAME_NODE, "before": before_nodes[0]["name"], "after": after_nodes[0]["name"]},
        "node_count": [len(before_nodes), len(after_nodes)],
        "efkefc_bytes": effect.stat().st_size,
        "efkefc_sha256": sha256(effect),
        "efk": str(exported),
        "efk_bytes": exported.stat().st_size,
        "checks": checks,
        "status": "PASS" if all(checks.values()) else "FAIL",
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
