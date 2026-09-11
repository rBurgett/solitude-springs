# Headless MPFB character generation (plan §4.3 candidate A).
#   flatpak run org.blender.Blender --background --python <abs>/generate.py -- <spec.json> <out dir>
# The spec lists figures: body sliders, skin, hair, body parts, clothes and an output name.
# Each figure is exported as a GLB (fixed body preset: shape keys evaluated and applied) plus a
# JSON sidecar with bone names and measured height for the runtime animator.
import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpfb_env import mpfb  # noqa: E402

HumanService = mpfb('mpfb.services.humanservice', 'HumanService')
HumanObjectProperties = mpfb('mpfb.entities.objectproperties', 'HumanObjectProperties')
TargetService = mpfb('mpfb.services.targetservice', 'TargetService')
AssetService = mpfb('mpfb.services.assetservice', 'AssetService')
ObjectService = mpfb('mpfb.services.objectservice', 'ObjectService')

argv = sys.argv[sys.argv.index('--') + 1:]
spec_path, out_dir = argv[0], argv[1]
only = argv[2] if len(argv) > 2 else None
os.makedirs(out_dir, exist_ok=True)
spec = json.load(open(spec_path))


def log(*a):
    print('[generate]', *a, flush=True)


def clear_scene():
    bpy.ops.wm.read_homefile(use_empty=True)


def find_mhclo(name, subdir):
    p = AssetService.find_asset_absolute_path(name + '.mhclo', asset_subdir=subdir)
    if not p:
        raise FileNotFoundError(f'{subdir}/{name}.mhclo not found in MPFB data roots')
    return p


def find_mhmat(name):
    p = AssetService.find_asset_absolute_path(name + '.mhmat', asset_subdir='skins')
    if not p:
        raise FileNotFoundError(f'skins/{name}.mhmat not found')
    return p


def measure_height(obj):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    zs = [ (obj.matrix_world @ v.co).z for v in mesh.vertices ]
    ev.to_mesh_clear()
    return (min(zs), max(zs))


def downscale_images(max_size):
    for img in bpy.data.images:
        if img.size[0] > max_size or img.size[1] > max_size:
            s = max_size / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))


def build(fig):
    t0 = time.time()
    clear_scene()
    macro = TargetService.get_default_macro_info_dict()
    for k, v in fig.get('macro', {}).items():
        if k == 'race':
            macro['race'].update(v)
        else:
            macro[k] = v
    basemesh = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    log(fig['name'], 'human created', f'{time.time() - t0:.1f}s')
    for target, weight in fig.get('targets', {}).items():
        TargetService.load_target(basemesh, TargetService.target_full_path(target), weight=weight, name=target)
    lo, hi = measure_height(basemesh)
    log(fig['name'], f'height before rig: {hi - lo:.3f} m (z {lo:.3f}..{hi:.3f})')
    rig = None
    if fig.get('rig'):
        rig = HumanService.add_builtin_rig(basemesh, fig['rig'], import_weights=True)
        log(fig['name'], 'rig', fig['rig'], 'bones:', len(rig.data.bones))
    if fig.get('skin'):
        HumanService.set_character_skin(find_mhmat(fig['skin']), basemesh, skin_type=fig.get('skin_type', 'GAMEENGINE'), material_instances=False)
    parts = []
    for part_type, subdir, name in [
        ('Eyes', 'eyes', fig.get('eyes')), ('Eyebrows', 'eyebrows', fig.get('eyebrows')), ('Eyelashes', 'eyelashes', fig.get('eyelashes')),
        ('Teeth', 'teeth', fig.get('teeth')), ('Tongue', 'tongue', fig.get('tongue')), ('Hair', 'hair', fig.get('hair')),
    ]:
        if not name:
            continue
        obj = HumanService.add_mhclo_asset(find_mhclo(name, subdir), basemesh, asset_type=part_type, subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=rig is not None)
        parts.append((part_type.lower(), name, obj))
    for name in fig.get('clothes', []):
        obj = HumanService.add_mhclo_asset(find_mhclo(name, 'clothes'), basemesh, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=rig is not None)
        parts.append(('clothes', name, obj))
    log(fig['name'], 'assets added', f'{time.time() - t0:.1f}s')
    # optional material overrides: {"asset name": {"color": [r,g,b,a]}}
    for kind, name, obj in parts:
        override = fig.get('materials', {}).get(name)
        if not override or obj is None:
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf and 'color' in override:
                inp = bsdf.inputs.get('Base Color')
                # detach any texture so the flat colour shows
                for link in list(inp.links):
                    mat.node_tree.links.remove(link)
                inp.default_value = override['color']
    downscale_images(fig.get('max_texture', 2048))
    # collect export selection
    objs = [basemesh] + [o for _, _, o in parts if o is not None]
    if rig is not None:
        objs.append(rig)
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    out = os.path.join(out_dir, fig['name'] + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_morph=False,
        export_skins=True, export_animations=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=85,
        export_texcoords=True, export_normals=True, export_materials='EXPORT',
    )
    lo, hi = measure_height(basemesh)
    side = {
        'name': fig['name'], 'height': hi - lo, 'rig': fig.get('rig'),
        'bones': [b.name for b in rig.data.bones] if rig is not None else [],
        'parts': [{'kind': k, 'asset': n, 'object': o.name if o is not None else None} for k, n, o in parts],
        'macro': macro,
    }
    json.dump(side, open(os.path.join(out_dir, fig['name'] + '.json'), 'w'), indent=1)
    log(fig['name'], 'exported', out, f'{os.path.getsize(out) / 1e6:.1f} MB', f'{time.time() - t0:.1f}s')


failures = []
for fig in spec['figures']:
    if only and fig['name'] != only:
        continue
    try:
        build(fig)
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        failures.append((fig['name'], str(e)))
if failures:
    for n, e in failures:
        log('FAILED', n, e)
    sys.exit(1)
log('done')
