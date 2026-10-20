# ##### BEGIN GPL LICENSE BLOCK #####
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 2
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with this program; if not, write to the Free Software Foundation,
#  Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# ##### END GPL LICENSE BLOCK #####

# <pep8 compliant>

import os
import math

import bmesh
import bpy
import mathutils
from contextlib import contextmanager
from ..animation_api import action_fcurves, curve_bone_name

from bpy_extras.wm_utils.progress_report import (
    ProgressReport,
    ProgressReportSubstep,
)   

# Remove spaces from given string (so it would be spaceless)
def name_compat(name):
    return 'None' if name is None else name.replace(' ', '_')

def export_action_name(action):
    return str(action.get('bbsfix_export_name', action.name)).strip() or action.name

def is_helper_camera_bone(bone):
    name = bone.name.lower()
    return name == 'camera' or name.startswith('camera_')

def is_helper_mesh(ob):
    if getattr(ob, 'type', None) != 'MESH':
        return False
    data = getattr(ob, 'data', None)
    return (
        data is not None
        and any(token in ob.name.lower() for token in ('verity.mdl', 'verity.smd'))
        and len(data.vertices) <= 4
    )

def helper_bone_names(armature):
    names = set()
    for bone in armature.data.bones:
        if is_helper_camera_bone(bone):
            names.add(bone.name)
    changed = True
    while changed:
        changed = False
        for bone in armature.data.bones:
            if bone.name not in names and bone.parent and bone.parent.name in names:
                names.add(bone.name)
                changed = True
    return names

# Triangulate polygons in given mesh
def mesh_triangulate(me):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()

# Write given armature to given file with applied matrix.
# Keep camera/helper bones in the bind skeleton: the known-good BOBJ keeps
# their hierarchy and weights, so filtering only part of it creates dangling
# skin references and makes the game reject the model.
def write_armature(fw, armature, global_matrix):
    fw('# Armature data\n')
    fw('arm_name %s\n' % armature.data.name)
    
    action = next((a for a in bpy.data.actions if a.get('bbsfix_export', True)
                   and exportable_curves(a, armature)), None)
    if action is not None:
        fw('arm_action %s\n' % export_action_name(action))
    
    for bone in armature.data.bones:
        parent = name_compat(bone.parent.name) if bone.parent is not None else ''
        
        tail = bone.matrix_local.copy()
        tail.translation = bone.tail_local
        tail = global_matrix @ armature.matrix_world @ tail
        
        vx, vy, vz = tail.translation[:]
        
        mat = global_matrix @ armature.matrix_world @ bone.matrix_local
        
        if bone.parent:
            mat = global_matrix @ armature.matrix_world @ bone.matrix_local
        
        m = ""
        
        for xx in range(0, 4):
            for yy in range(0, 4):
                m += str(mat.row[xx][yy]) + ' '
        
        # Write the bone to the file (name, parent name,)
        string = 'arm_bone %s %s ' % (name_compat(bone.name), parent)
        string += '%f %f %f ' % (vx, vy, vz)
        string += m + '\n'
        
        fw(string)

# Writes all action keyframes
def exportable_curves(action, arm):
    curves = list(action_fcurves(action, arm))
    bones = set(arm.data.bones.keys()) if arm else None
    return [fc for fc in curves if fc.data_path.startswith('pose.bones["')
            and fc.keyframe_points
            and (bones is None or curve_bone_name(fc) in bones)]


def write_actions(context, fw, skip_bones=None, arm=None):
    fw('# Animation data\n')
    if arm is None:
        obj = context.object
        arm = obj if obj and obj.type == 'ARMATURE' else None
    
    # Exporting animation actions
    for key, action in bpy.data.actions.items():
        # BBSFix writes this flag only for scanned Actions.  Missing means
        # legacy/external exporter behavior: export the Action as before.
        if action.get('bbsfix_export', True) is False:
            continue
        if not exportable_curves(action, arm):
            continue
        write_action(
            context,
            fw,
            export_action_name(action),
            action,
            skip_bones or set(),
            arm,
        )
                   
# Write an action
def write_action(context, fw, name, action, skip_bones=None, arm=None):
    groups = {}
    
    def getOrCreate(key):
        if key in groups:
            return groups[key]
        
        l = []
        groups[key] = l
        
        return l
    
    # Collect groups
    for fc in exportable_curves(action, arm):
        if fc.data_path.startswith('pose.bones["'):
            key = curve_bone_name(fc)

            if key in (skip_bones or set()):
                continue
            
            getOrCreate(key).append(fc)
    
    # Don't write anything if this action is empty
    if not groups:
        return
    
    fw('an %s\n' % name)
    
    for key, group in groups.items():
        fw('ao %s\n' % name_compat(key))
        quaternions = {fc.array_index: fc for fc in group if fc.data_path.endswith('rotation_quaternion')}
        pose_bone = arm.pose.bones.get(key) if arm else None
        if pose_bone and pose_bone.rotation_mode != 'QUATERNION':
            quaternions = {}
        if quaternions:
            write_quaternion_curves(context, fw, quaternions)
        
        for fcurve in group:
            if quaternions and fcurve.data_path.endswith('rotation_euler'):
                continue
            data_path = fcurve.data_path
            index = fcurve.array_index
            length = len(fcurve.keyframe_points)
            dvalue = 0
        
            if data_path.endswith('location'):
                data_path = 'location'
            elif data_path.endswith('rotation_euler'):
                data_path = 'rotation'
            elif data_path.endswith('scale'):
                data_path = 'scale'
                dvalue = 1
            else:
                continue
            
            if length <= 0:
                continue

            all_default = True

            # Prevent writing actions which fully consist out of default values
            for keyframe in fcurve.keyframe_points:
                if keyframe.co[1] != dvalue:
                    all_default = False

                    break;

            if all_default: 
                continue

            # Write the action group
            fw('ag %s %d\n' % (data_path, index))
        
            last_frame = None
        
            for keyframe in fcurve.keyframe_points:
                # Avoid inserting keyframes with duplicate X value
                if last_frame == keyframe.co[0]:
                    continue
            
                fw(stringify_keyframe(context, keyframe) + '\n')
                last_frame = keyframe.co[0]

def write_quaternion_curves(context, fw, curves):
    """Bake export-only XYZ values without changing the source Action or pose."""
    keyed = {float(k.co[0]) for fc in curves.values() for k in fc.keyframe_points}
    if not keyed:
        return
    frames = sorted(keyed | set(range(math.floor(min(keyed)), math.ceil(max(keyed)) + 1)))
    samples = []
    previous = None
    factor = 20 * context.scene.render.fps_base / context.scene.render.fps
    for frame in frames:
        q = mathutils.Quaternion([curves[i].evaluate(frame) if i in curves else (1 if i == 0 else 0) for i in range(4)])
        if q.magnitude < 1e-12:
            q = mathutils.Quaternion()
        q.normalize()
        euler = q.to_euler('XYZ', previous) if previous is not None else q.to_euler('XYZ')
        previous = euler.copy()
        samples.append((frame * factor, euler))
    for axis in range(3):
        fw('ag rotation %d\n' % axis)
        # Several Blender frames may fall on one Minecraft tick. Keep the
        # latest sample, including the final keyed pose, instead of dropping it.
        ticks = {int(frame): (frame, euler) for frame, euler in samples}
        for tick, (frame, euler) in ticks.items():
            fw('kf %d %f LINEAR %f %f %f %f\n' % (tick, euler[axis], frame, euler[axis], frame, euler[axis]))


# Stringify a keyframe
def stringify_keyframe(context, keyframe):
    fps = context.scene.render.fps
    f = 20 * context.scene.render.fps_base / fps

    interp = keyframe.interpolation
    result = 'kf %d %f %s' % (keyframe.co[0] * f, keyframe.co[1], interp)
    result += ' %f %f %f %f' % (keyframe.handle_left[0] * f, keyframe.handle_left[1], keyframe.handle_right[0] * f, keyframe.handle_right[1])
    
    return result

def mesh_armature(ob):
    if ob.parent and ob.parent.type == 'ARMATURE':
        return ob.parent
    return next((m.object for m in ob.modifiers if m.type == 'ARMATURE' and m.object), None)


@contextmanager
def bind_pose(context, objects):
    """Evaluate bone attachments at rest; never bake armature deformation into skin."""
    arms = {ob for ob in objects if ob.type == 'ARMATURE'}
    arms.update(mesh_armature(ob) for ob in objects if ob.type == 'MESH' and mesh_armature(ob))
    poses = [(arm, arm.data.pose_position) for arm in arms]
    modifiers = [(m, m.show_viewport) for ob in objects if ob.type == 'MESH'
                 for m in ob.modifiers if m.type == 'ARMATURE']
    try:
        for arm, _ in poses:
            arm.data.pose_position = 'REST'
        for modifier, _ in modifiers:
            modifier.show_viewport = False
        context.view_layer.update()
        yield
    finally:
        for arm, pose in poses:
            arm.data.pose_position = pose
        for modifier, visible in modifiers:
            modifier.show_viewport = visible
        context.view_layer.update()


def save(context,
         filepath,
         *,
         keep_vertex_order=False,
         use_selection=True,
         include_keyframes=True,
         include_geometry=True,
         global_matrix=None):

    objects = list(context.selected_objects if use_selection else context.scene.objects)
    with bind_pose(context, objects):
        _write(context, filepath,
           EXPORT_KEEP_VERT_ORDER=keep_vertex_order,
           EXPORT_SEL_ONLY=use_selection,
           EXPORT_KEYFRAMES=include_keyframes,
           EXPORT_GEOMETRY=include_geometry,
           EXPORT_GLOBAL_MATRIX=global_matrix,
        )

    return {'FINISHED'}

def _write(context, filepath,
           EXPORT_KEEP_VERT_ORDER,
           EXPORT_SEL_ONLY, 
           EXPORT_KEYFRAMES,
           EXPORT_GEOMETRY,
           EXPORT_GLOBAL_MATRIX):
    with ProgressReport(context.window_manager) as progress:
        scene = context.scene
        depsgraph = context.evaluated_depsgraph_get()

        # Exit edit mode before exporting, so current object states are exported properly.
        if bpy.ops.object.mode_set.poll():
            bpy.ops.object.mode_set(mode='OBJECT')

        objects = context.selected_objects if EXPORT_SEL_ONLY else scene.objects

        progress.enter_substeps(1)
        write_file(context, filepath, objects, depsgraph, scene,
                   EXPORT_KEEP_VERT_ORDER,
                   EXPORT_GLOBAL_MATRIX,
                   EXPORT_KEYFRAMES,
                   EXPORT_GEOMETRY,
                   progress)
        progress.leave_substeps()

def write_file(context, filepath, objects, depsgraph, scene,
               EXPORT_KEEP_VERT_ORDER=False,
               EXPORT_GLOBAL_MATRIX=None,
               EXPORT_KEYFRAMES=True,
               EXPORT_GEOMETRY=True,
               progress=ProgressReport()):
    if EXPORT_GLOBAL_MATRIX is None:
        EXPORT_GLOBAL_MATRIX = mathutils.Matrix.Identity(4)

    def veckey3d(v):
        return round(v.x, 4), round(v.y, 4), round(v.z, 4)

    def veckey2d(v):
        return round(v[0], 5), round(v[1], 5)

    with ProgressReportSubstep(progress, 2, "BOBJ Export path: %r" % filepath, "BOBJ Export Finished") as subprogress1:
        with open(filepath, "w", encoding="utf8", newline="\n") as f:
            fw = f.write

            # Write Header
            fw('# Blender v%s Blockbuster OBJ File: %r\n' % (bpy.app.version_string, os.path.basename(bpy.data.filepath)))
            fw('# www.blender.org\n')

            # Initialize totals, these are updated each object
            totverts = totuvco = totno = 1
            face_vert_index = 1
            
            # Export all meshes
            if EXPORT_GEOMETRY:
                subprogress1.enter_substeps(len(objects))
                for i, ob_main in enumerate(objects):
                    # ignore dupli children
                    if ob_main.parent and ob_main.parent.instance_type in {'VERTS', 'FACES'}:
                        subprogress1.step("Ignoring %s, dupli child..." % ob_main.name)
                        continue

                    obs = [(ob_main, ob_main.matrix_world)]
                    if ob_main.is_instancer:
                        obs += [(dup.instance_object.original, dup.matrix_world.copy())
                                for dup in depsgraph.object_instances
                                if dup.parent and dup.parent.original == ob_main]
                        # ~ print(ob_main.name, 'has', len(obs) - 1, 'dupli children')

                    subprogress1.enter_substeps(len(obs))
                    for ob, ob_mat in obs:
                        with ProgressReportSubstep(subprogress1, 6) as subprogress2:
                            uv_unique_count = no_unique_count = 0

                            # Exporting armature data
                            if ob.type == 'ARMATURE':
                                write_armature(fw, ob, EXPORT_GLOBAL_MATRIX)
                                continue
                            if ob.type != 'MESH':
                                continue

                            ob_for_convert = ob.evaluated_get(depsgraph)

                            try:
                                me = ob_for_convert.to_mesh()
                            except RuntimeError:
                                me = None

                            if me is None:
                                continue

                            # Transform object's and global matrix and triangulate the mesh
                            me.transform(EXPORT_GLOBAL_MATRIX @ ob_mat)
                            mesh_triangulate(me)

                            # Prepare UV data
                            faceuv = len(me.uv_layers) > 0
                            if faceuv:
                                uv_layer = me.uv_layers.active.data[:]

                            me_verts = me.vertices[:]

                            # Make our own list so it can be sorted to reduce context switching
                            face_index_pairs = [(face, index) for index, face in enumerate(me.polygons)]

                            # If there is no data to write, skip it
                            if not (len(face_index_pairs) + len(me.vertices)):  
                                ob_for_convert.to_mesh_clear()
                                continue

                            if face_index_pairs and hasattr(me, 'calc_normals_split'):
                                me.calc_normals_split()

                            loops = me.loops

                            # Sort by Material, then images
                            # so we dont over context switch in the obj file.
                            sort_func = lambda a: a[0].use_smooth
                            face_index_pairs.sort(key=sort_func)
                            
                            del sort_func

                            fw('# Mesh data\n')
                            # Write out the object's name and parent armature (if it has any)
                            fw('o %s\n' % name_compat(ob.name))
                            
                            arm = mesh_armature(ob)
                            if arm:
                                fw('o_arm %s\n' % arm.data.name)
                            rigid = arm and ob.parent == arm and ob.parent_type == 'BONE'
                            if rigid and ob.parent_bone not in arm.data.bones:
                                raise ValueError('Bone parent không tồn tại: ' + ob.name)

                            subprogress2.step()

                            # Write vertices and weights
                            for v in me_verts:
                                fw('v %.6f %.6f %.6f\n' % v.co[:])
                                
                                if rigid:
                                    fw('vw %s 1.000000\n' % name_compat(ob.parent_bone))
                                elif arm:
                                    for vgroup in v.groups:
                                        bone_name = ob.vertex_groups[vgroup.group].name
                                        if bone_name in arm.data.bones and vgroup.weight > 0:
                                            fw('vw %s %.6f\n' % (name_compat(bone_name), vgroup.weight))

                            subprogress2.step()

                            # Export UVs
                            if not faceuv:
                                fw('vt 0.0000 0.0000\n')
                                uv_unique_count = 1
                                uv_face_mapping = [[0] * len(face.vertices) for face in me.polygons]
                            if faceuv:
                                uv = f_index = uv_index = uv_key = uv_val = uv_ls = None
                                uv_face_mapping = [None] * len(face_index_pairs)

                                uv_dict = {}
                                uv_get = uv_dict.get
                                for f, f_index in face_index_pairs:
                                    uv_ls = uv_face_mapping[f_index] = []
                                    for uv_index, l_index in enumerate(f.loop_indices):
                                        uv = uv_layer[l_index].uv
                                        uv_key = loops[l_index].vertex_index, veckey2d(uv)

                                        uv_val = uv_get(uv_key)
                                        if uv_val is None:
                                            uv_val = uv_dict[uv_key] = uv_unique_count
                                            fw('vt %.4f %.4f\n' % uv[:])
                                            uv_unique_count += 1
                                        uv_ls.append(uv_val)

                                del uv_dict, uv, f_index, uv_index, uv_ls, uv_get, uv_key, uv_val

                            subprogress2.step()

                            # Export normals
                            no_key = no_val = None
                            normals_to_idx = {}
                            no_get = normals_to_idx.get
                            loops_to_normals = [0] * len(loops)
                            for f, f_index in face_index_pairs:
                                for l_idx in f.loop_indices:
                                    normal = me.corner_normals[l_idx].vector if hasattr(me, 'corner_normals') else loops[l_idx].normal
                                    no_key = veckey3d(normal)
                                    no_val = no_get(no_key)
                                    if no_val is None:
                                        no_val = normals_to_idx[no_key] = no_unique_count
                                        fw('vn %.4f %.4f %.4f\n' % no_key)
                                        no_unique_count += 1
                                    loops_to_normals[l_idx] = no_val
                            del normals_to_idx, no_get, no_key, no_val

                            subprogress2.step()

                            # Finally write out face indices
                            for f, f_index in face_index_pairs:
                                f_v = [(vi, me_verts[v_idx], l_idx) for vi, (v_idx, l_idx) in enumerate(zip(f.vertices, f.loop_indices))]

                                fw('f')
                                for vi, v, li in f_v:
                                    # vertex, UV, normal
                                    fw(" %d/%d/%d" % (totverts + v.index, totuvco + uv_face_mapping[f_index][vi], totno + loops_to_normals[li]))  
                                                    
                                    face_vert_index += len(f_v)
                                fw('\n')

                            subprogress2.step()

                            # Make the indices global rather then per mesh
                            totverts += len(me_verts)
                            totuvco += uv_unique_count
                            totno += no_unique_count

                            # clean up
                            ob_for_convert.to_mesh_clear()

                    subprogress1.leave_substeps("Finished writing geometry of '%s'." % ob_main.name)
                
                subprogress1.leave_substeps()

            # Write keyframes to the file   
            if EXPORT_KEYFRAMES:
                armatures = [ob for ob in objects if ob.type == 'ARMATURE']
                skip_bones = (
                    helper_bone_names(armatures[0])
                    if armatures else set()
                )
                if len(armatures) > 1:
                    raise ValueError('Xuất từng Armature riêng để tránh trùng Action/slot.')
                write_actions(context, fw, skip_bones, armatures[0] if armatures else None)
            
        subprogress1.step("Finished exporting geometry")
