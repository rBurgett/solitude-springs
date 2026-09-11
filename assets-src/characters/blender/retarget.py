# Retarget Quaternius Universal Animation Library clips onto an MPFB game_engine rig and export
# an animation-only GLB (plan §4.4, owner decision §1 #25).
#
#   flatpak run org.blender.Blender --background --python <abs>/retarget.py -- \
#       <abs>/assets-src/characters/animations.json <abs target character .glb> <abs out .glb> [--poses <abs>/poses.json] [--only name,name]
#
# Method (world-space rotation deltas with per-bone rest alignment):
#   Bone names match between the two rigs (Unreal-mannequin family) but bone rolls and the rest
#   poses differ, so local rotation tracks cannot be copied. Instead, for every mapped bone the
#   source's world-space rotation *delta from its own rest* is applied to the target's rest
#   rotation, after the target rest has been re-aimed so the bone points the way the source's
#   rest bone points (this removes the A-pose angle mismatch). Leaf bones (head, toes,
#   fingertips) inherit their parent's alignment. The pelvis also gets the source's hip
#   translation scaled by the hip-height ratio. Everything else keeps the target's bone lengths,
#   so the result is the source motion on the MPFB proportions.
#
# The target is any character GLB produced by generate.py: its armature is imported with the
# 'BLENDER' bone heuristic so that the exported rest pose round-trips exactly; the runtime
# re-binds the clips onto other MPFB bodies (src/character/animLibrary.ts).
import json
import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
manifest_path, target_glb, out_glb = argv[0], argv[1], argv[2]
poses_path = None
only = None
i = 3
while i < len(argv):
    if argv[i] == '--poses':
        poses_path = argv[i + 1]
        i += 2
    elif argv[i] == '--only':
        only = set(argv[i + 1].split(','))
        i += 2
    else:
        raise SystemExit(f'unknown argument {argv[i]}')

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
manifest = json.load(open(manifest_path))
FPS = int(manifest.get('fps', 30))


def log(*a):
    print('[retarget]', *a, flush=True)


# Which child defines a bone's direction for rest alignment. Leaves inherit the parent's alignment.
DIR_CHILD = {
    'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head',
}
for s in ('l', 'r'):
    DIR_CHILD.update({
        f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}', f'hand_{s}': f'middle_01_{s}',
        f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}',
    })
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        DIR_CHILD[f'{f}_01_{s}'] = f'{f}_02_{s}'
        DIR_CHILD[f'{f}_02_{s}'] = f'{f}_03_{s}'


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER', guess_original_bind_pose=False, import_shading='NORMALS')
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == 'ARMATURE']
    if len(arms) != 1:
        raise RuntimeError(f'{path}: expected exactly one armature, found {len(arms)}')
    return arms[0], new


def find_bone(arm, name):
    b = arm.data.bones.get(name)
    if b is None:
        # case-insensitive fallback (UAL uses "Head" and "root")
        for cand in arm.data.bones:
            if cand.name.lower() == name.lower():
                return cand
    return b


def world_rest(arm):
    """Rest rotation (Quaternion) and head position (Vector) per bone, in world space."""
    rot, pos = {}, {}
    mw = arm.matrix_world
    for b in arm.data.bones:
        m = mw @ b.matrix_local
        rot[b.name] = m.to_quaternion()
        pos[b.name] = m.translation.copy()
    return rot, pos


def bones_parent_first(arm):
    out = []

    def visit(b):
        out.append(b)
        for c in b.children:
            visit(c)

    for b in arm.data.bones:
        if b.parent is None:
            visit(b)
    return out


# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0

t0 = time.time()
tgt_arm, tgt_objs = import_glb(target_glb)
for o in tgt_objs:
    if o is not tgt_arm:
        bpy.data.objects.remove(o, do_unlink=True)
tgt_arm.name = 'rig'
tgt_arm.animation_data_clear()
if tgt_arm.matrix_world != Matrix.Identity(4):
    log('WARNING target armature has a non-identity transform', tgt_arm.matrix_world)
log('target', os.path.basename(target_glb), 'bones', len(tgt_arm.data.bones), f'{time.time() - t0:.1f}s')

# Source rigs: one armature per UAL file, with the clips as actions.
sources = {}
for key, rel in manifest['sources'].items():
    path = rel if os.path.isabs(rel) else os.path.join(REPO, rel)
    actions_before = set(bpy.data.actions)
    arm, objs = import_glb(path)
    for o in objs:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = f'src_{key}'
    actions = {}
    ad = arm.animation_data
    if ad:
        for tr in list(ad.nla_tracks):
            for st in tr.strips:
                if st.action:
                    actions.setdefault(tr.name, st.action)
                    actions.setdefault(st.action.name, st.action)
            ad.nla_tracks.remove(tr)
        ad.action = None
    for a in bpy.data.actions:
        if a not in actions_before:
            actions.setdefault(a.name, a)
    sources[key] = {'arm': arm, 'actions': actions}
    log('source', key, 'bones', len(arm.data.bones), 'actions', len(set(actions.values())))

# ---------------------------------------------------------------------------------------------
# Rest data + alignment
T_rot, T_pos = world_rest(tgt_arm)
tgt_bones = bones_parent_first(tgt_arm)


def rest_dir(pos, name, child):
    d = pos[child] - pos[name]
    return d.normalized() if d.length > 1e-6 else None


def build_alignment(src_arm):
    S_rot, S_pos = world_rest(src_arm)
    mapping = {}   # target bone name -> source bone name
    align = {}     # target bone name -> Quaternion re-aiming the target rest onto the source rest direction
    for b in tgt_bones:
        sb = find_bone(src_arm, b.name)
        if sb is None:
            continue
        mapping[b.name] = sb.name
    for b in tgt_bones:
        if b.name not in mapping:
            continue
        child = DIR_CHILD.get(b.name)
        A = None
        if child and child in mapping and child in T_pos and mapping[child] in S_pos:
            dt = rest_dir(T_pos, b.name, child)
            ds = rest_dir(S_pos, mapping[b.name], mapping[child])
            if dt is not None and ds is not None:
                A = dt.rotation_difference(ds)
        if A is None:
            A = align.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        align[b.name] = A
    return S_rot, S_pos, mapping, align


# Sanity: both rigs must face the same way (foot bones point forward) and have the left hand on +X.
def facing_report(name, rot, pos):
    fd = rest_dir(pos, 'foot_l', 'ball_l') if 'foot_l' in pos and 'ball_l' in pos else None
    hl = pos.get('hand_l')
    log(f'{name}: foot_l dir {tuple(round(v, 2) for v in fd) if fd else None}  hand_l x={hl.x:.2f} z={hl.z:.2f}' if hl else f'{name}: no hand_l')


facing_report('target', T_rot, T_pos)
for key, s in sources.items():
    S_rot, S_pos, mapping, align = build_alignment(s['arm'])
    s.update({'S_rot': S_rot, 'S_pos': S_pos, 'mapping': mapping, 'align': align})
    unmapped = [b.name for b in tgt_bones if b.name not in mapping]
    facing_report(f'source {key}', S_rot, S_pos)
    log(f'source {key}: mapped {len(mapping)}/{len(tgt_bones)} target bones; unmapped: {unmapped}')
    hip_t = T_pos['pelvis'].z
    hip_s = S_pos[mapping['pelvis']].z
    s['hip_scale'] = hip_t / hip_s
    log(f'source {key}: hip height target {hip_t:.3f} source {hip_s:.3f} scale {s["hip_scale"]:.3f}')
    # alignment angles for the main limbs, for the log
    for n in ('pelvis', 'spine_01', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l'):
        if n in align:
            log(f'   align {n:11s} {math.degrees(align[n].angle):6.1f}°')


# ---------------------------------------------------------------------------------------------
def action_fcurves(act):
    """F-curves of an action across Blender's legacy and slotted (4.4+) layouts."""
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for cb in getattr(strip, 'channelbags', []):
                out.extend(cb.fcurves)
    return out


def ensure_action(arm, name):
    act = bpy.data.actions.new(name)
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if hasattr(act, 'slots') and getattr(ad, 'action_slot', None) is None:
        slot = act.slots.new(id_type='OBJECT', name=arm.name)
        ad.action_slot = slot
    return act


def push_to_nla(arm, act, name, start):
    ad = arm.animation_data
    ad.action = None
    tr = ad.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, int(start), act)
    st.name = name
    if hasattr(st, 'action_slot') and hasattr(act, 'slots') and len(act.slots):
        try:
            st.action_slot = act.slots[0]
        except Exception:  # noqa: BLE001
            pass
    tr.mute = True
    return tr


def set_pose_from_world(pb_by_name, world_rot, world_pos_pelvis=None):
    """Assign matrix_basis rotations (and pelvis location) so the target bones reach `world_rot`."""
    for b in tgt_bones:
        W = world_rot.get(b.name)
        if W is None:
            continue
        pb = pb_by_name[b.name]
        parent = b.parent
        if parent:
            Wp = world_rot.get(parent.name, T_rot[parent.name])
            basis = T_rot[b.name].inverted() @ T_rot[parent.name] @ Wp.inverted() @ W
        else:
            basis = T_rot[b.name].inverted() @ W
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = basis.normalized()
        if b.name == 'pelvis' and world_pos_pelvis is not None:
            pb.location = T_rot['pelvis'].inverted() @ (world_pos_pelvis - T_pos['pelvis'])


pb_by_name = {pb.name: pb for pb in tgt_arm.pose.bones}
for pb in tgt_arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

clip_stats = []
baked = {}


def retarget_clip(entry):
    src = sources[entry['source']]
    arm = src['arm']
    act = src['actions'].get(entry['clip'])
    if act is None:
        raise KeyError(f"clip {entry['clip']} not found in {entry['source']}; have {sorted(set(src['actions']))[:80]}")
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if hasattr(act, 'slots') and getattr(ad, 'action_slot', None) is None and len(act.slots):
        ad.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    f0, f1 = int(round(f0)), int(round(f1))
    n = f1 - f0 + 1
    S_rot, S_pos, mapping, align = src['S_rot'], src['S_pos'], src['mapping'], src['align']
    hip_scale = src['hip_scale']
    src_pb = {pb.name: pb for pb in arm.pose.bones}
    mw = arm.matrix_world
    tact = ensure_action(tgt_arm, entry['name'])
    pmin = Vector((1e9,) * 3)
    pmax = Vector((-1e9,) * 3)
    for k in range(n):
        f = f0 + k
        scene.frame_set(f)
        world_rot = {}
        for b in tgt_bones:
            sname = mapping.get(b.name)
            if sname is None:
                continue
            Sf = (mw @ src_pb[sname].matrix).to_quaternion()
            D = Sf @ S_rot[sname].inverted()
            world_rot[b.name] = D @ align[b.name] @ T_rot[b.name]
        sp = (mw @ src_pb[mapping['pelvis']].matrix).translation
        dp = (sp - S_pos[mapping['pelvis']]) * hip_scale
        pelvis_world = T_pos['pelvis'] + dp
        pmin = Vector(min(a, b) for a, b in zip(pmin, dp))
        pmax = Vector(max(a, b) for a, b in zip(pmax, dp))
        set_pose_from_world(pb_by_name, world_rot, pelvis_world)
        for b in tgt_bones:
            if b.name in world_rot:
                pb = pb_by_name[b.name]
                pb.keyframe_insert('rotation_quaternion', frame=k)
                if b.name == 'pelvis':
                    pb.keyframe_insert('location', frame=k)
    # linear interpolation keeps the sampled motion honest between keys
    for fc in action_fcurves(tact):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    push_to_nla(tgt_arm, tact, entry['name'], 0)
    ad.action = None
    baked[entry['name']] = tact
    clip_stats.append({'name': entry['name'], 'frames': n, 'duration': (n - 1) / FPS, 'loop': bool(entry.get('loop')), 'pelvisRange': [round(v, 3) for v in (pmax - pmin)]})
    log(f"{entry['name']:22s} {entry['source']}:{entry['clip']:24s} {n:3d} frames  hip travel x/y/z {tuple(round(v, 2) for v in (pmax - pmin))}")
    return tact


manifest_by_name = {e['name']: e for e in manifest['clips']}


def get_action(name):
    """A baked target action by clip name, retargeting it on demand (for --only runs)."""
    if name not in baked:
        retarget_clip(manifest_by_name[name])
    return baked[name]


for entry in manifest['clips']:
    if only and entry['name'] not in only:
        continue
    retarget_clip(entry)

# ---------------------------------------------------------------------------------------------
# Hand-authored clips (poses.json): keyframed limb aims/orients in the character frame, baked here.
if poses_path:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import poses as poselib  # noqa: E402

    poses_spec = json.load(open(poses_path))
    baker = poselib.PoseBaker({
        'T_rot': T_rot, 'T_pos': T_pos, 'tgt_bones': tgt_bones, 'tgt_arm': tgt_arm, 'pb_by_name': pb_by_name,
        'set_pose_from_world': set_pose_from_world, 'ensure_action': ensure_action, 'push_to_nla': push_to_nla,
        'action_fcurves': action_fcurves, 'get_action': get_action, 'fps': FPS, 'poses_spec': poses_spec,
    })
    for clip in poses_spec['clips']:
        if only and clip['name'] not in only:
            continue
        n = baker.bake(clip)
        clip_stats.append({'name': clip['name'], 'frames': n, 'duration': (n - 1) / FPS, 'loop': bool(clip.get('loop')), 'authored': True})
        log(f"{clip['name']:22s} authored {n:3d} frames")

# reset pose
for pb in tgt_arm.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = Vector((0, 0, 0))
scene.frame_set(0)

# ---------------------------------------------------------------------------------------------
for o in bpy.data.objects:
    o.select_set(False)
tgt_arm.select_set(True)
bpy.context.view_layer.objects.active = tgt_arm
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True, export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False, export_anim_single_armature=True, export_reset_pose_bones=True,
    export_rest_position_armature=True, export_skins=True, export_morph=False, export_materials='NONE', export_yup=True,
)
side = {
    'target': os.path.basename(target_glb), 'fps': FPS, 'hipHeight': T_pos['pelvis'].z,
    'clips': clip_stats,
}
json.dump(side, open(os.path.splitext(out_glb)[0] + '.json', 'w'), indent=1)
log('exported', out_glb, f'{os.path.getsize(out_glb) / 1e6:.1f} MB', f'{time.time() - t0:.1f}s total')
