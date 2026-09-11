# Diagnose why the exported skeleton doesn't coincide with the mesh: prints object transforms,
# mesh bounds (base vs evaluated) and world-space bone heads after create_human + add_builtin_rig.
import json, os, sys
import bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpfb_env import mpfb

HumanService = mpfb('mpfb.services.humanservice', 'HumanService')
TargetService = mpfb('mpfb.services.targetservice', 'TargetService')

spec = json.load(open(sys.argv[sys.argv.index('--') + 1]))
fig = spec['figures'][0]
bpy.ops.wm.read_homefile(use_empty=True)
macro = TargetService.get_default_macro_info_dict()
for k, v in fig['macro'].items():
    if k == 'race':
        macro['race'].update(v)
    else:
        macro[k] = v
bm = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)

def bounds(obj, evaluated):
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        me = obj.evaluated_get(dg).to_mesh()
    else:
        me = obj.data
    zs = [(obj.matrix_world @ v.co).z for v in me.vertices]
    return (min(zs), max(zs), len(zs))

print('BASEMESH location', tuple(bm.location), 'scale', tuple(bm.scale), 'dims', tuple(bm.dimensions))
print('BASEMESH base-coord z range (world):', bounds(bm, False))
print('BASEMESH evaluated z range (world):', bounds(bm, True))
print('shape keys:', [k.name for k in bm.data.shape_keys.key_blocks] if bm.data.shape_keys else None)
rig = HumanService.add_builtin_rig(bm, fig['rig'], import_weights=True)
print('RIG location', tuple(rig.location), 'scale', tuple(rig.scale), 'parent', rig.parent.name if rig.parent else None)
print('BASEMESH parent', bm.parent.name if bm.parent else None, 'location after rig', tuple(bm.location), 'matrix_world t', tuple(bm.matrix_world.translation))
for name in ('Root', 'pelvis', 'spine_03', 'upperarm_r', 'lowerarm_r', 'head', 'foot_r'):
    b = rig.data.bones.get(name)
    if b:
        h = rig.matrix_world @ b.head_local
        print(f'bone {name:11s} head world z={h.z:.3f} (x={h.x:.3f}, y={h.y:.3f})')
print('BASEMESH evaluated z range after rig:', bounds(bm, True))
mods = [(m.type, m.name) for m in bm.modifiers]
print('modifiers', mods)

RigService = mpfb('mpfb.services.rigservice', 'RigService')
print('--- trying RigService.refit_existing_armature ---')
try:
    RigService.refit_existing_armature(rig, bm)
    for name in ('pelvis', 'upperarm_r', 'head', 'foot_r'):
        b = rig.data.bones.get(name)
        h = rig.matrix_world @ b.head_local
        print(f'REFIT bone {name:11s} head world z={h.z:.3f} (x={h.x:.3f}, y={h.y:.3f})')
except Exception as e:  # noqa: BLE001
    import traceback; traceback.print_exc()
