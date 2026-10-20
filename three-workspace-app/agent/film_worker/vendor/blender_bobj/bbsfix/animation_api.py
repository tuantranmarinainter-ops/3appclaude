"""Slot-aware access shared by BBSFix and its bundled BOBJ exporter."""
import re
import bpy

_BONE = re.compile(r'^pose\.bones\["(.+)"\]\.')


def curve_bone_name(curve):
    match = _BONE.match(curve.data_path)
    return bpy.utils.unescape_identifier(match.group(1)) if match else None


def channelbags(action, slot):
    if slot is None:
        return []
    return [bag for layer in action.layers for strip in layer.strips
            if strip.type == 'KEYFRAME'
            for bag in [strip.channelbag(slot)] if bag is not None]


def resolve_slot(action, arm=None):
    if not hasattr(action, 'slots'):
        return None
    if arm is None:
        obj = bpy.context.object
        arm = obj if obj and obj.type == 'ARMATURE' else None
    slots = [s for s in action.slots if s.target_id_type == 'OBJECT']
    if arm is not None:
        ad = arm.animation_data
        linked = []
        if ad:
            if ad.action == action and ad.action_slot:
                linked.append(ad.action_slot)
            for track in ad.nla_tracks:
                for strip in track.strips:
                    if strip.action == action and strip.action_slot:
                        linked.append(strip.action_slot)
        handles = {s.handle for s in linked}
        if len(handles) > 1:
            raise ValueError('Action {} dùng nhiều slot trên {}; hãy tách thành Action riêng.'.format(action.name, arm.name))
        if linked:
            return linked[0]
        bones = set(arm.data.bones.keys())
        candidates = []
        for slot in slots:
            users = list(slot.users())
            if users and arm not in users:
                continue
            names = {curve_bone_name(fc)
                     for bag in channelbags(action, slot) for fc in bag.fcurves
                     if curve_bone_name(fc) is not None and fc.keyframe_points}
            if names and names.issubset(bones):
                candidates.append(slot)
        named = [s for s in candidates if s.name_display == arm.name]
        slots = named or candidates
    if len(slots) > 1:
        raise ValueError('Action {} có nhiều slot phù hợp; chọn slot cho Armature trước khi quét.'.format(action.name))
    return slots[0] if slots else None


class CurveAccess:
    def __init__(self, action, arm=None):
        self.action = action
        self.legacy = getattr(action, 'fcurves', None)
        self.slot = resolve_slot(action, arm) if self.legacy is None else None
        self.bags = channelbags(action, self.slot) if self.legacy is None else []
        if len(self.bags) > 1:
            raise ValueError('Action {} có nhiều layer/strip; cần bake trước khi xuất BOBJ.'.format(action.name))

    def __iter__(self):
        if self.legacy is not None:
            return iter(self.legacy)
        return iter([fc for bag in self.bags for fc in bag.fcurves])

    def new(self, data_path, index=0, action_group=None):
        if self.legacy is not None:
            return self.legacy.new(data_path, index=index, action_group=action_group or '')
        if not self.bags:
            raise ValueError('Action không có channelbag để thêm F-Curve')
        return self.bags[0].fcurves.new(data_path, index=index, group_name=action_group or '')

    def remove(self, curve):
        if self.legacy is not None:
            self.legacy.remove(curve)
            return
        for bag in self.bags:
            if any(fc == curve for fc in bag.fcurves):
                bag.fcurves.remove(curve)
                return
        raise ValueError('F-Curve không thuộc slot đang chọn')


def action_fcurves(action, arm=None):
    return CurveAccess(action, arm)


def assign_action(arm, action, slot=None):
    arm.animation_data_create()
    if action is not None and slot is None:
        slot = resolve_slot(action, arm)
    arm.animation_data.action = action
    if action is not None and slot is not None:
        arm.animation_data.action_slot = slot
