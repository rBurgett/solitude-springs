# Hand-authored clips for the MPFB rig, baked by retarget.py (plan §4.4 "hand-authored").
#
# poses.json describes named poses as per-bone operations in the CHARACTER FRAME used by the
# runtime (three.js at yaw 0): +x = the character's left, +y = up, +z = forward. A clip is a
# list of timed keys, each a pose; the baker evaluates every key to world-space bone rotations
# (parent-first, each op rotating the bone's whole subtree, so it behaves like posing in a
# viewport) and slerps between keys with an ease curve. Finger shapes are borrowed from
# retargeted clips (a gripping hand from the sword idle, a relaxed one from the idle).
#
# Ops per bone (logical names from src/character/boneMap.ts or raw bone names):
#   aim:    [x, y, z]                 point the bone (head→child) along a direction
#   orient: {axis, dir, up_axis, up}  point a bone-local axis along `dir`, then roll so that
#                                     bone-local `up_axis` faces `up` as closely as possible
#   twist:  [[x, y, z], degrees]      rotate about a character-frame axis
#   roll:   degrees                   rotate about the bone's own current direction
#   offset: [x, y, z]                 pelvis only: translate (metres)
import math
import os

from mathutils import Quaternion, Vector

LOGICAL = {
    'hips': 'pelvis', 'spine1': 'spine_01', 'spine2': 'spine_02', 'spine3': 'spine_03', 'neck': 'neck_01', 'head': 'head',
    'clavicleL': 'clavicle_l', 'upperArmL': 'upperarm_l', 'lowerArmL': 'lowerarm_l', 'handL': 'hand_l',
    'clavicleR': 'clavicle_r', 'upperArmR': 'upperarm_r', 'lowerArmR': 'lowerarm_r', 'handR': 'hand_r',
    'upperLegL': 'thigh_l', 'lowerLegL': 'calf_l', 'footL': 'foot_l', 'upperLegR': 'thigh_r', 'lowerLegR': 'calf_r', 'footR': 'foot_r',
}
DIR_CHILD = {
    'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head',
    'clavicle_l': 'upperarm_l', 'upperarm_l': 'lowerarm_l', 'lowerarm_l': 'hand_l', 'hand_l': 'middle_01_l',
    'clavicle_r': 'upperarm_r', 'upperarm_r': 'lowerarm_r', 'lowerarm_r': 'hand_r', 'hand_r': 'middle_01_r',
    'thigh_l': 'calf_l', 'calf_l': 'foot_l', 'foot_l': 'ball_l', 'thigh_r': 'calf_r', 'calf_r': 'foot_r', 'foot_r': 'ball_r',
}
FINGER_PREFIXES = ('index_', 'middle_', 'ring_', 'pinky_', 'thumb_')


def cf(v):
    """Character frame (x left, y up, z forward) → Blender world (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


def smoothstep(u):
    return u * u * (3 - 2 * u)


class PoseBaker:
    def __init__(self, ctx):
        self.ctx = ctx
        self.T_rot = ctx['T_rot']
        self.T_pos = ctx['T_pos']
        self.bones = ctx['tgt_bones']          # parent-first Bone list
        self.children = {b.name: [c.name for c in b.children] for b in self.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in self.bones}
        self.spec = ctx['poses_spec']
        self.finger_cache = {}

    # ---- pose evaluation -------------------------------------------------------------------
    def descendants(self, name):
        out = []
        stack = list(self.children[name])
        while stack:
            n = stack.pop()
            out.append(n)
            stack.extend(self.children[n])
        return out

    def resolve_pose(self, name_or_ops):
        if isinstance(name_or_ops, str):
            p = self.spec['poses'][name_or_ops]
        else:
            p = name_or_ops
        ops = {}
        if 'extends' in p:
            ops.update(self.resolve_pose(p['extends']))
        for k, v in p.items():
            if k == 'extends':
                continue
            ops[LOGICAL.get(k, k)] = v
        return ops

    def evaluate(self, ops):
        W = {b.name: self.T_rot[b.name].copy() for b in self.bones}
        pelvis = self.T_pos['pelvis'].copy()

        def rotate_subtree(name, R):
            W[name] = R @ W[name]
            for d in self.descendants(name):
                W[d] = R @ W[d]

        def cur_dir(name):
            child = DIR_CHILD.get(name)
            if child is None:
                return W[name] @ Vector((0, 1, 0))
            local = self.T_rot[name].inverted() @ (self.T_pos[child] - self.T_pos[name])
            return (W[name] @ local).normalized()

        for b in self.bones:
            op = ops.get(b.name)
            if not op:
                continue
            if 'aim' in op:
                R = cur_dir(b.name).rotation_difference(cf(op['aim']).normalized())
                rotate_subtree(b.name, R)
            if 'orient' in op:
                o = op['orient']
                axis = Vector(o.get('axis', (0, 1, 0)))
                d = cf(o['dir']).normalized()
                R1 = (W[b.name] @ axis).normalized().rotation_difference(d)
                rotate_subtree(b.name, R1)
                if 'up' in o:
                    up_axis = Vector(o.get('up_axis', (0, 0, 1)))
                    u = W[b.name] @ up_axis
                    h = cf(o['up'])
                    u = (u - d * u.dot(d))
                    h = (h - d * h.dot(d))
                    if u.length > 1e-6 and h.length > 1e-6:
                        # signed angle about d (rotation_difference would pick an arbitrary axis when u ≈ -h)
                        u.normalize()
                        h.normalize()
                        angle = math.atan2(u.cross(h).dot(d), u.dot(h))
                        rotate_subtree(b.name, Quaternion(d, angle))
            if 'twist' in op:
                axis, deg = op['twist']
                rotate_subtree(b.name, Quaternion(cf(axis).normalized(), math.radians(deg)))
            if 'roll' in op:
                rotate_subtree(b.name, Quaternion(cur_dir(b.name), math.radians(op['roll'])))
            if 'offset' in op and b.name == 'pelvis':
                pelvis += cf(op['offset'])
        return W, pelvis

    # ---- finger shapes borrowed from baked clips ---------------------------------------------
    def fingers(self, side, source):
        """Basis quaternions of one hand's finger bones from a retargeted clip at a frame."""
        clip, frame = source
        key = (side, clip, frame)
        if key in self.finger_cache:
            return self.finger_cache[key]
        act = self.ctx['get_action'](clip)
        out = {}
        for fc in self.ctx['action_fcurves'](act):
            path = fc.data_path
            if not path.endswith('rotation_quaternion') or '"' not in path:
                continue
            bone = path.split('"')[1]
            if not bone.startswith(FINGER_PREFIXES) or not bone.endswith('_' + side):
                continue
            out.setdefault(bone, [1.0, 0.0, 0.0, 0.0])[fc.array_index] = fc.evaluate(frame)
        res = {k: Quaternion(v).normalized() for k, v in out.items()}
        self.finger_cache[key] = res
        return res

    # ---- baking ------------------------------------------------------------------------------
    def bake(self, clip):
        ctx = self.ctx
        fps = ctx['fps']
        keys = list(clip['keys'])
        if clip.get('loop') and keys and keys[-1]['t'] < clip.get('duration', keys[-1]['t']):
            keys.append({'t': clip['duration'], 'pose': keys[0]['pose'], 'ease': keys[-1].get('ease', 'smooth')})
        evaluated = []
        for k in keys:
            W, pelvis = self.evaluate(self.resolve_pose(k['pose']))
            evaluated.append((k['t'], W, pelvis, k.get('ease', 'smooth')))
            if os.environ.get('POSE_DEBUG'):
                import bpy
                self.ctx['set_pose_from_world'](self.ctx['pb_by_name'], W, pelvis)
                bpy.context.view_layer.update()
                for name in ('hand_r', 'lowerarm_r', 'upperarm_r'):
                    pb = self.ctx['pb_by_name'][name]
                    actual = (self.ctx['tgt_arm'].matrix_world @ pb.matrix).to_quaternion()
                    f = lambda v: tuple(round(x, 2) for x in v)
                    print(f"[pose-debug] {clip['name']} key {k['pose']!s:12s} {name:11s} wanted X->{f(W[name] @ Vector((1, 0, 0)))} Y->{f(W[name] @ Vector((0, 1, 0)))}  actual X->{f(actual @ Vector((1, 0, 0)))} Y->{f(actual @ Vector((0, 1, 0)))}")
        finger_basis = {}
        for side, source in clip.get('fingers', {}).items():
            finger_basis.update(self.fingers(side, source))
        duration = evaluated[-1][0]
        n = int(round(duration * fps)) + 1
        act = ctx['ensure_action'](ctx['tgt_arm'], clip['name'])
        pb_by_name = ctx['pb_by_name']
        for f in range(n):
            t = f / fps
            # find the key span
            j = 0
            while j < len(evaluated) - 2 and t >= evaluated[j + 1][0]:
                j += 1
            t0, W0, p0, _ = evaluated[j]
            t1, W1, p1, ease = evaluated[min(j + 1, len(evaluated) - 1)]
            u = 0.0 if t1 <= t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
            if ease == 'smooth':
                u = smoothstep(u)
            elif ease == 'in':
                u = u * u
            elif ease == 'out':
                u = 1 - (1 - u) * (1 - u)
            W = {name: W0[name].slerp(W1[name], u) for name in W0}
            pelvis = p0.lerp(p1, u)
            ctx['set_pose_from_world'](pb_by_name, W, pelvis)
            for bone, q in finger_basis.items():
                pb_by_name[bone].rotation_quaternion = q
            for b in self.bones:
                pb = pb_by_name[b.name]
                pb.keyframe_insert('rotation_quaternion', frame=f)
                if b.name == 'pelvis':
                    pb.keyframe_insert('location', frame=f)
        for fc in ctx['action_fcurves'](act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        ctx['push_to_nla'](ctx['tgt_arm'], act, clip['name'], 0)
        return n
