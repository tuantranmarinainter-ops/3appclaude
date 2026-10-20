"""generation record / list / show: offline bookkeeping of images and videos made from render frames."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from topview_3d_cli import local_cli
from topview_3d_cli.local_project import init_project
from topview_3d_cli.tests.test_local_cli import box, upsert, write_ops
from topview_3d_cli.tests.test_local_reads import write_run

VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"v" * 200


def run(capsys, *argv):
    code = local_cli.main([str(item) for item in argv])
    captured = capsys.readouterr()
    return code, json.loads(captured.out or captured.err)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "p"
    init_project(root)
    write_run(root, "run-a", 2, "2026-01-01T00:00:00Z")
    return root


def spec_file(tmp_path, **overrides):
    result = tmp_path / "result.mp4"
    result.write_bytes(VIDEO)
    spec = {"kind": "video", "provider": "example", "model": "m1", "prompt": "two people talk",
            "references": [{"runId": "run-a", "frame": 0}], "outputs": [{"file": str(result)}]}
    spec.update(overrides)
    path = tmp_path / "spec.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    return path


def test_record_copies_the_output_and_keeps_provenance(capsys, project, tmp_path):
    code, body = run(capsys, "generation", "record", project, spec_file(tmp_path))
    assert code == 0
    generation = body["generation"]
    out = generation["outputs"][0]
    stored = Path(out["path"])
    assert stored.parent == project.resolve() / ".topview-3d" / "generations" / generation["id"]
    assert stored.name == "out-1.mp4" and stored.read_bytes() == VIDEO
    assert out["sha256"] == hashlib.sha256(VIDEO).hexdigest() and out["sourceName"] == "result.mp4"
    reference = generation["references"][0]
    assert reference["runId"] == "run-a" and reference["frame"] == 0 and reference["stale"] is False
    assert reference["sha256"] == hashlib.sha256(b"\x89PNG\r\n\x1a\n" + b"\0" * 300).hexdigest()
    assert generation["sceneSequence"] == body["sceneSequence"]
    assert list((project / ".topview-3d" / "generations").glob(".tmp-*")) == []
    assert str(tmp_path) not in (stored.parent / "generation.json").read_text(encoding="utf-8")


def test_record_does_not_change_the_scene(capsys, project, tmp_path):
    before = {p.name: p.read_bytes() for p in (project / ".topview-3d").glob("*.json")}
    code, _ = run(capsys, "generation", "record", project, spec_file(tmp_path))
    assert code == 0
    assert {p.name: p.read_bytes() for p in (project / ".topview-3d").glob("*.json")} == before


def test_list_and_show_follow_the_scene(capsys, project, tmp_path):
    code, body = run(capsys, "generation", "list", project)
    assert code == 0 and body["count"] == 0
    code, body = run(capsys, "generation", "show", project)
    assert code == 2 and body["code"] == "GENERATION_NOT_FOUND"
    _, first = run(capsys, "generation", "record", project, spec_file(tmp_path))
    code, body = run(capsys, "generation", "list", project)
    assert body["count"] == 1 and body["generations"][0]["id"] == first["generation"]["id"]
    assert body["generations"][0]["sceneChangedSince"] is False
    code, body = run(capsys, "generation", "show", project)
    assert code == 0 and body["generation"]["id"] == first["generation"]["id"]
    # Editing the scene afterwards makes the generation older than the scene.
    code, _ = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]))
    assert code == 0
    code, body = run(capsys, "generation", "list", project)
    assert body["generations"][0]["sceneChangedSince"] is True
    code, body = run(capsys, "generation", "show", project)
    assert body["generation"]["sceneChangedSince"] is True


def test_show_detects_a_tampered_output(capsys, project, tmp_path):
    _, made = run(capsys, "generation", "record", project, spec_file(tmp_path))
    Path(made["generation"]["outputs"][0]["path"]).write_bytes(b"changed")
    code, body = run(capsys, "generation", "show", project, made["generation"]["id"])
    assert code == 1 and body["code"] == "GENERATION_FILE_INVALID"


def test_failed_attempt_may_have_no_output(capsys, project, tmp_path):
    spec = spec_file(tmp_path, status="failed", outputs=[], notes="service refused the prompt")
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 0 and body["generation"]["status"] == "failed" and body["generation"]["outputs"] == []


@pytest.mark.parametrize(("override", "fragment"), [
    ({"apiKey": "sk-secret"}, "unknown field"),
    ({"kind": "audio"}, "kind must be"),
    ({"provider": "https://api.example.com"}, "provider is a short name"),
    ({"prompt": ""}, "prompt must be"),
    ({"references": []}, "references must list"),
    ({"references": [{"runId": "run-a", "frame": 0, "path": "x"}]}, "each reference"),
    ({"references": [{"video": "missing.mp4"}]}, "is not a non-empty file"),
    ({"references": [{"video": "notes.txt"}]}, "a video reference must be"),
    ({"references": [{"video": "x.mp4", "runId": "run-a"}]}, "each reference"),
    ({"outputs": []}, "at least one output"),
    ({"outputs": [{"file": "a.txt"}]}, "must be one of"),
    ({"outputs": [{"file": "x.mp4", "url": "https://e.com/x.mp4"}]}, "exactly one of"),
    ({"outputs": [{"url": "ftp://e.com/x.mp4"}]}, "plain http(s) address"),
    ({"outputs": [{"url": "https://e.com/x.mp4?X-Amz-Signature=abc"}]}, "signature or token"),
    ({"outputs": [{"url": "https://e.com/x.mp4?token=abc"}]}, "signature or token"),
    ({"outputs": [{"url": "https://user:pw@e.com/x.mp4"}]}, "plain http(s) address"),
])
def test_invalid_specs_write_nothing(capsys, project, tmp_path, override, fragment):
    code, body = run(capsys, "generation", "record", project, spec_file(tmp_path, **override))
    assert code == 2 and body["code"] == "GENERATION_INVALID" and fragment in body["error"]
    assert not (project / ".topview-3d" / "generations").exists()


def test_a_plain_address_is_recorded_without_fetching(capsys, project, tmp_path):
    spec = spec_file(tmp_path, outputs=[{"url": "https://cdn.example.com/result.mp4"}])
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 0 and body["generation"]["outputs"] == [{"url": "https://cdn.example.com/result.mp4"}]


def test_unknown_render_run_is_rejected(capsys, project, tmp_path):
    spec = spec_file(tmp_path, references=[{"runId": "nope"}])
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 2 and body["code"] == "RENDER_NOT_FOUND"
    assert not (project / ".topview-3d" / "generations").exists()


def test_an_exported_video_can_be_the_reference(capsys, project, tmp_path):
    exported = tmp_path / "studio-export.mp4"
    exported.write_bytes(VIDEO + b"export")
    spec = spec_file(tmp_path, references=[{"video": str(exported)}], notes="omni, Video1 = export")
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 0
    reference = body["generation"]["references"][0]
    assert reference["kind"] == "video" and reference["sourceName"] == "studio-export.mp4"
    assert reference["sha256"] == hashlib.sha256(VIDEO + b"export").hexdigest()
    assert reference["sizeBytes"] == len(VIDEO) + 6
    assert reference["stale"] is None and reference["sceneChecked"] is False
    assert body["generation"]["stale"] is False
    assert str(tmp_path) not in json.dumps(reference)
    # the export itself is not copied into the project; only the generated output is
    stored = {path.name for path in Path(body["generation"]["directory"]).iterdir()}
    assert stored == {"generation.json", "out-1.mp4"}


def test_video_and_frame_references_can_be_mixed(capsys, project, tmp_path):
    exported = tmp_path / "studio-export.mp4"
    exported.write_bytes(VIDEO)
    spec = spec_file(tmp_path, references=[{"video": str(exported)}, {"runId": "run-a", "frame": 0}])
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 0 and [ref["kind"] for ref in body["generation"]["references"]] == ["video", "frame"]


def test_stale_reference_is_flagged(capsys, project, tmp_path):
    write_run(project, "run-old", 1, "2025-01-01T00:00:00Z")
    spec = spec_file(tmp_path, references=[{"runId": "run-old"}])
    code, body = run(capsys, "generation", "record", project, spec)
    assert code == 0 and body["generation"]["references"][0]["stale"] is True and body["generation"]["stale"] is True
