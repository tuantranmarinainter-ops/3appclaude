"""Read-only GLB exchange rig validator (v1.0.0 and additive v1.1.0)."""
import json
import math
import re
import struct

CORE = set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandIndex4', 'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3', 'LeftHandMiddle4', 'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3', 'LeftHandPinky4', 'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3', 'LeftHandRing4', 'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3', 'LeftHandThumb4', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandIndex4', 'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3', 'RightHandMiddle4', 'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3', 'RightHandPinky4', 'RightHandRing1', 'RightHandRing2', 'RightHandRing3', 'RightHandRing4', 'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3', 'RightHandThumb4'])


def validate_extra_bones(manifest):
    version, rig, extras = manifest.get("version"), manifest.get("rig"), manifest.get("extraBones")
    if version == "1.0.0":
        if rig not in (None, "mixamo65") or "extraBones" in manifest:
            raise ValueError("v1.0 requires mixamo65 without extraBones")
        return []
    if version != "1.1.0":
        raise ValueError("Unsupported GLB contract version")
    if not isinstance(rig, str) or not re.fullmatch(r"mixamo65\+[A-Za-z0-9][A-Za-z0-9_-]*", rig) or not isinstance(extras, list) or not extras:
        raise ValueError("v1.1 requires an extended rig and nonempty extraBones")
    by_name = {}
    for bone in extras:
        if not isinstance(bone, dict):
            raise ValueError("Invalid extra bone")
        name = bone.get("name")
        if not isinstance(name, str) or name in CORE or name in by_name or not re.fullmatch(r"X_[A-Za-z0-9_]+_[A-Za-z0-9_]+", name):
            raise ValueError("Invalid or duplicate extra bone name")
        if not isinstance(bone.get("parent"), str) or not isinstance(bone.get("rest"), dict):
            raise ValueError("Missing extra bone parent/rest")
        for key, size in (("position", 3), ("rotation", 4), ("scale", 3)):
            vector = bone["rest"].get(key)
            if not isinstance(vector, list) or len(vector) != size or not all(type(v) in (float, int) and math.isfinite(v) for v in vector):
                raise ValueError("Extra bone rest must contain finite TRS vectors")
        by_name[name] = bone
    for bone in extras:
        parent = bone["parent"]
        if parent not in CORE and parent not in by_name:
            raise ValueError("Missing extra bone parent")
        seen = {bone["name"]}
        while parent in by_name:
            if parent in seen:
                raise ValueError("Extra bone parent cycle")
            seen.add(parent)
            parent = by_name[parent]["parent"]
        if not bone["name"].startswith("X_" + parent + "_"):
            raise ValueError("Extra bone name must identify its core parent")
    return extras


def validate_glb_contract(data, manifest):
    extras = validate_extra_bones(manifest)
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<II", data, 4) != (2, len(data)):
        raise ValueError("Invalid GLB header")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A or 20 + length > len(data):
        raise ValueError("Invalid GLB JSON chunk")
    gltf = json.loads(data[20:20 + length])
    nodes = gltf.get("nodes", [])
    joints = gltf.get("skins", [{}])[0].get("joints", [])
    names = [nodes[i].get("name") for i in joints]
    expected = CORE | {bone["name"] for bone in extras}
    if len(names) != len(expected) or len(set(names)) != len(names) or set(names) != expected:
        raise ValueError("GLB joints do not match contract rig")
    for bone in extras:
        index = joints[names.index(bone["name"])]
        parents = [node for node in nodes if index in node.get("children", [])]
        if len(parents) != 1 or parents[0].get("name") != bone["parent"]:
            raise ValueError("GLB extra parent differs from manifest")
        for field, key, default in (("translation", "position", [0, 0, 0]), ("rotation", "rotation", [0, 0, 0, 1]), ("scale", "scale", [1, 1, 1])):
            values = nodes[index].get(field, default)
            if "matrix" in nodes[index] or len(values) != len(bone["rest"][key]) or any(type(v) not in (float, int) or not math.isfinite(v) or abs(v - bone["rest"][key][i]) > 1e-6 for i, v in enumerate(values)):
                raise ValueError("GLB extra rest differs from manifest")
