"""Run inside Blender to convert one FBX or self-contained GLB into BOBJ."""

import argparse
import hashlib
import json
import math
import re
import sys
import traceback
from pathlib import Path

import bpy
from bpy_extras.io_utils import axis_conversion
from mathutils import Matrix


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--unit-meters", required=True, type=float)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--basis", required=True, type=float, nargs=9)
    return parser.parse_args(argv)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def static_prop_armature(meshes):
    """Armature with a single "root" bone at the origin; every mesh keeps its world placement and is fully weighted to it."""
    data = bpy.data.armatures.new("PropArmature")
    armature = bpy.data.objects.new("PropArmature", data)
    bpy.context.scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    bone = data.edit_bones.new("root")
    bone.head, bone.tail = (0, 0, 0), (0, 0.1, 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    for mesh in meshes:
        world = mesh.matrix_world.copy()
        mesh.parent = armature
        mesh.matrix_world = world
        group = mesh.vertex_groups.get("root") or mesh.vertex_groups.new(name="root")
        group.add(range(len(mesh.data.vertices)), 1.0, "REPLACE")
        modifier = mesh.modifiers.new("PropArmature", "ARMATURE")
        modifier.object = armature
    return armature


def imported_armature():
    armatures = [item for item in bpy.context.scene.objects if item.type == "ARMATURE"]
    # shortcut: Blender's glTF helper collection name is importer-defined; update this filter if Blender renames it.
    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH" and not any(collection.name == "glTF_not_exported" for collection in item.users_collection)]
    if not armatures and meshes:
        # A static prop (scene backdrop): give it one "root" bone so it travels as a BOBJ model like a Character.
        armatures = [static_prop_armature(meshes)]
    if len(armatures) != 1 or not meshes or not armatures[0].data.bones:
        raise ValueError("The source must contain one armature and at least one mesh")
    armature = armatures[0]
    bone_names = {bone.name for bone in armature.data.bones}
    for mesh in meshes:
        linked = mesh.parent == armature or any(
            modifier.type == "ARMATURE" and modifier.object == armature
            for modifier in mesh.modifiers
        ) or any(group.name in bone_names for group in mesh.vertex_groups)
        if not linked:
            raise ValueError(f"Mesh {mesh.name} is not linked to armature {armature.name}")
        if mesh.data.shape_keys:
            raise ValueError("Shape keys are not supported by this BOBJ conversion")
        if mesh.data.color_attributes:
            raise ValueError("Vertex color attributes are not supported by this BOBJ conversion")
    return armature, meshes


def save_texture(meshes, output_dir):
    images = {}
    textured_materials = set()
    for mesh in meshes:
        for material in mesh.data.materials:
            if not material or not material.use_nodes or not material.node_tree:
                continue
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    key = bpy.path.abspath(node.image.filepath)
                    if not key:
                        key = hashlib.sha256(bytes(node.image.packed_file.data)).hexdigest() if node.image.packed_file else node.image.name
                    images.setdefault(key, node.image)
                    textured_materials.add(material)
    if len(images) > 1:
        paths = sorted(images)
        raise ValueError("BOBJ conversion supports one shared model texture; atlas multiple material images first (" + ", ".join(paths) + ")")
    if not images:
        return save_palette_texture(meshes, output_dir)
    if any(not mesh.data.uv_layers for mesh in meshes if any(material in textured_materials for material in mesh.data.materials)):
        raise ValueError("Textured BOBJ meshes require UV coordinates")
    image = next(iter(images.values()))
    temp_source = None
    temporary_image = None
    if image.packed_file:
        data = bytes(image.packed_file.data)
        suffix = ".png" if data.startswith(b"\x89PNG\r\n\x1a\n") else ".jpg" if data.startswith(b"\xff\xd8\xff") else None
        if suffix is None:
            raise ValueError("Packed material texture must be PNG or JPEG")
        temp_source = output_dir / (".source-texture" + suffix)
        temp_source.write_bytes(data)
        image = bpy.data.images.load(str(temp_source), check_existing=False)
        image.reload()
        _ = image.pixels[0]
        temporary_image = True
    elif not image.has_data and image.filepath:
        image.reload()
    if not image.has_data or min(image.size) <= 0 or image.source not in {"FILE", "GENERATED"}:
        raise ValueError(f"The source material texture is missing or uses unsupported image data ({image.source}, has_data={image.has_data}, size={tuple(image.size)}, packed={bool(image.packed_file)})")
    image_path = output_dir / "model.png"
    copy = image if temporary_image else image.copy()
    try:
        copy.filepath_raw = str(image_path)
        copy.file_format = "PNG"
        copy.save()
    finally:
        bpy.data.images.remove(copy)
        if temp_source:
            temp_source.unlink(missing_ok=True)
    with image_path.open("rb") as stream:
        signature = stream.read(8)
    if signature != b"\x89PNG\r\n\x1a\n":
        prefix = signature.hex()
        raise ValueError(f"Blender did not write a valid model.png ({prefix})")
    return True


def material_color(material):
    """Linear RGBA of a flat-colored material (Principled Base Color, else viewport diffuse)."""
    if material.use_nodes and material.node_tree:
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                return tuple(node.inputs["Base Color"].default_value)
    return tuple(material.diffuse_color)


def linear_to_srgb(channel):
    channel = max(0.0, min(1.0, channel))
    return channel * 12.92 if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055


def save_palette_texture(meshes, output_dir):
    """Flat material colors would be lost in BOBJ (texture only): bake them into a palette model.png and point
    every face's UVs at the centre of its material's cell. Returns False when there is nothing to bake."""
    palette = []
    for mesh in meshes:
        for material in mesh.data.materials:
            if material and material not in palette:
                palette.append(material)
    if not palette:
        return False
    cell = 4
    width, height = cell * len(palette), cell
    image = bpy.data.images.new("bbs_palette", width=width, height=height, alpha=True)
    pixels = [0.0] * (width * height * 4)
    for index, material in enumerate(palette):
        r, g, b, a = material_color(material)
        rgba = (linear_to_srgb(r), linear_to_srgb(g), linear_to_srgb(b), max(0.0, min(1.0, a)))
        for y in range(height):
            for x in range(index * cell, (index + 1) * cell):
                offset = (y * width + x) * 4
                pixels[offset:offset + 4] = rgba
    image.pixels[:] = pixels
    for mesh in meshes:
        data = mesh.data
        layer = data.uv_layers.active or data.uv_layers.new(name="bbs_palette")
        data.uv_layers.active = layer
        for polygon in data.polygons:
            material = data.materials[polygon.material_index] if polygon.material_index < len(data.materials) else None
            index = palette.index(material) if material in palette else 0
            u = (index * cell + cell / 2) / width
            for loop_index in polygon.loop_indices:
                layer.data[loop_index].uv = (u, 0.5)
    image_path = output_dir / "model.png"
    try:
        image.filepath_raw = str(image_path)
        image.file_format = "PNG"
        image.save()
    finally:
        bpy.data.images.remove(image)
    return True


def parse_profile(model_path):
    bones = []
    actions = []
    for line in model_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("arm_bone "):
            fields = line.split()
            if len(fields) == 22:
                name, parent = fields[1], fields[2]
                matrix_start = 6
            elif len(fields) == 21:
                name, parent = fields[1], None
                matrix_start = 5
            else:
                raise ValueError("The BOBJ exporter wrote an unrecognized arm_bone record")
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name):
                raise ValueError("BOBJ bone names must use letters, digits, dot, underscore or hyphen")
            matrix = [float(value) for value in fields[matrix_start:matrix_start + 16]]
            if len(matrix) != 16 or not all(math.isfinite(value) for value in matrix):
                raise ValueError("The BOBJ exporter wrote an invalid rest matrix")
            bones.append({"name": name, "sourceName": name, "parent": parent, "bobjRestMatrixRowMajor": matrix})
        elif line.startswith("an "):
            actions.append(line[3:].strip())
    names = {bone["name"] for bone in bones}
    if not bones or len(names) != len(bones):
        raise ValueError("The exported BOBJ has no bones or duplicate bone names")
    for bone in bones:
        if bone["parent"] is not None and bone["parent"] not in names:
            raise ValueError("The exported BOBJ contains a missing parent bone")
    if len(actions) != len(set(actions)):
        raise ValueError("The exported BOBJ contains duplicate action names")
    return bones, actions


def safe_bone_names(source_names):
    exported = [name.replace(" ", "_") for name in source_names]
    if len(set(exported)) != len(exported):
        raise ValueError("The imported skeleton has duplicate BOBJ-compatible bone names")
    used = {name for name in exported if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name)}
    aliases = {}
    index = 0
    for source_name, export_name in zip(source_names, exported):
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", export_name):
            continue
        while True:
            candidate = f"bone{index}"
            index += 1
            if candidate not in used:
                used.add(candidate)
                aliases[export_name] = candidate
                break
    return aliases


def fbx_loader_bone_name(name):
    return re.sub(r"[\[\].:/]", "", re.sub(r"\s", "_", name))


def rewrite_bobj_bone_names(model_path, aliases):
    if not aliases:
        return
    content = model_path.read_text(encoding="utf-8")
    for source, target in aliases.items():
        content = re.sub(r"(?<!\S)" + re.escape(source) + r"(?!\S)", target, content)
    model_path.write_text(content, encoding="utf-8")


def convert(args):
    source = args.source.resolve(strict=True)
    output_dir = args.output_dir.resolve(strict=True)
    if source.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source), global_scale=args.unit_meters, use_anim=True)
    elif source.suffix.lower() == ".glb":
        if args.unit_meters != 1:
            raise ValueError("GLB source uses meters and must use unit-meters 1")
        bpy.ops.import_scene.gltf(filepath=str(source))
    else:
        raise ValueError("Only FBX and GLB sources are supported")

    armature, meshes = imported_armature()
    if len(armature.data.bones) > 512:
        raise ValueError("The imported skeleton exceeds 512 bones")
    texture_required = save_texture(meshes, output_dir)
    from bbsfix.bobj402 import export_bobj
    transform = axis_conversion(to_forward="Z", to_up="Y").to_4x4()
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    result = export_bobj.save(
        bpy.context,
        filepath=str(output_dir / "model.bobj"),
        use_selection=True,
        include_keyframes=True,
        include_geometry=True,
        global_matrix=Matrix((
            (*args.basis[0:3], 0), (*args.basis[3:6], 0), (*args.basis[6:9], 0), (0, 0, 0, 1),
        )) @ transform,
    )
    if result != {"FINISHED"}:
        raise RuntimeError("BBSFix BOBJ exporter did not finish")
    model_path = output_dir / "model.bobj"
    if not model_path.is_file() or model_path.stat().st_size <= 0:
        raise RuntimeError("BBSFix BOBJ exporter produced no model.bobj")
    source_names = [bone.name for bone in armature.data.bones]
    aliases = safe_bone_names(source_names)
    rewrite_bobj_bone_names(model_path, aliases)
    bones, actions = parse_profile(model_path)
    source_by_export = {name.replace(" ", "_"): fbx_loader_bone_name(name) for name in source_names}
    source_by_alias = {alias: source_by_export[export_name] for export_name, alias in aliases.items()}
    for bone in bones:
        bone["sourceName"] = source_by_alias.get(bone["name"], source_by_export.get(bone["name"], bone["name"]))
    files = [{"targetPath": "model.bobj", "sha256": sha256(model_path)}]
    if texture_required:
        files.append({"targetPath": "model.png", "sha256": sha256(output_dir / "model.png")})
    profile = {
        "schemaVersion": 1,
        "modelId": args.model_id,
        "sourceSha256": sha256(source),
        "metersPerUnit": args.unit_meters,
        "bones": bones,
        "actions": actions,
        "textureRequired": texture_required,
        "files": files,
    }
    (output_dir / "profile.json").write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return profile


def main():
    args = arguments()
    status = args.output_dir / "conversion-status.json"
    try:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor" / "blender_bobj"))
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        profile = convert(args)
        status.write_text(json.dumps({"ok": True, "profile": profile}), encoding="utf-8")
    except Exception as error:
        status.write_text(json.dumps({"ok": False, "error": str(error), "traceback": traceback.format_exc()}), encoding="utf-8")
        print("BBS_MODEL_CONVERSION_FAILED:", error)


main()
