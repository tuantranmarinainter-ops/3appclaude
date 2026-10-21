"""Blender worker: import GLB, retain scene animation, and export .blend plus baked FBX."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--fps", required=True, type=int)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
source, output = Path(args.input), Path(args.output)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = args.fps
bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
scene = bpy.context.scene
scene.render.fps = args.fps
ranges = [tuple(action.frame_range) for action in bpy.data.actions]
scene.frame_start = math.floor(min((r[0] for r in ranges), default=1))
scene.frame_end = math.ceil(max((r[1] for r in ranges), default=1))
scene.frame_set(scene.frame_start)
objects = {kind: sum(obj.type == kind for obj in scene.objects) for kind in ("MESH", "ARMATURE", "CAMERA", "EMPTY")}
# Pack textures into the .blend; embed them in FBX as COPY resources.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(output / "scene.blend"))
bpy.ops.export_scene.fbx(filepath=str(output / "scene.fbx"), use_selection=False, add_leaf_bones=False,
    bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False,
    bake_anim_force_startend_keying=True, bake_anim_step=1.0, bake_anim_simplify_factor=0.0,
    path_mode="COPY", embed_textures=True, axis_forward="-Z", axis_up="Y")
summary = {"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "fps": args.fps,
    "frameStart": scene.frame_start, "frameEnd": scene.frame_end, "objects": objects,
    "actions": len(bpy.data.actions), "blenderVersion": bpy.app.version_string}
(output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
