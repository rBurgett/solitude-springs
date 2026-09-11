# Headless MPFB character generation (plan §4.3 candidate A, §5 player bodies).
#   flatpak run org.blender.Blender --background --python <abs>/generate.py -- <spec.json> <out dir> [figureName]
# The spec lists figures: body sliders, skin (+ extra skins for the creator's swatches), hair styles,
# body parts, garments and an output name. Each figure is exported as a GLB (fixed body preset:
# shape keys evaluated and applied) plus a JSON sidecar (bone names, measured height, parts).
#
# Naming inside the GLB (consumed by src/character/character.ts):
#   Human            body mesh          Human.rig    armature
#   Human.<asset>    eyes / eyebrows / eyelashes
#   hair_<id>        one mesh per hairstyle (all exported; the runtime shows one)
#   garment_<id>     one skinned mesh per garment incl. the underwear layer (runtime toggles)
# (underscores, not colons: three.js strips '.', ':' and '/' from node names)
# Garment materials: `color` = flat colour (texture detached); `tint` = pack texture kept with a
# white base colour so the runtime can multiply a colour; `pattern` = generated texture (polka).
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
    zs = [(obj.matrix_world @ v.co).z for v in mesh.vertices]
    ev.to_mesh_clear()
    return (min(zs), max(zs))


def downscale_object_images(obj, max_size):
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            img = getattr(n, 'image', None)
            if img and (img.size[0] > max_size or img.size[1] > max_size):
                s = max_size / max(img.size[0], img.size[1])
                img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))


def principled(mat):
    return next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat and mat.use_nodes else None


def polka_image(name, size=512, dots=6, radius=0.16, base=(1.0, 1.0, 1.0), dot=(0.85, 0.08, 0.1)):
    """White ground with a staggered grid of red dots (owner decision §1 #26)."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    cell = size / dots
    r2 = (radius * cell) ** 2
    for y in range(size):
        row = int(y // cell)
        off = 0.5 * cell if row % 2 else 0.0
        for x in range(size):
            cx = ((x + off) % cell) - cell / 2
            cy = (y % cell) - cell / 2
            c = dot if cx * cx + cy * cy < r2 else base
            i = (y * size + x) * 4
            px[i:i + 4] = (c[0], c[1], c[2], 1.0)
    img.pixels = px
    img.pack()
    return img


def apply_material_override(obj, override):
    """`color` flat colour / `tint` white base + texture / `pattern` generated texture."""
    for slot in obj.material_slots:
        mat = slot.material
        bsdf = principled(mat)
        if not bsdf:
            continue
        inp = bsdf.inputs.get('Base Color')
        if 'pattern' in override:
            for link in list(inp.links):
                mat.node_tree.links.remove(link)
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = polka_image(f'{obj.name}_{override["pattern"]}') if override['pattern'] == 'polka' else None
            mat.node_tree.links.new(tex.outputs['Color'], inp)
            inp.default_value = (1, 1, 1, 1)
        elif 'color' in override:
            for link in list(inp.links):
                mat.node_tree.links.remove(link)
            inp.default_value = override['color']
        elif override.get('tint'):
            inp.default_value = (1, 1, 1, 1)
        # matte cloth by default
        rough = bsdf.inputs.get('Roughness')
        if rough and not rough.links:
            rough.default_value = max(rough.default_value, 0.7)


def export_skin_diffuse(mhmat_path, out_path, max_size):
    """Save a skin's diffuse texture as JPEG for runtime swapping (creator skin swatches)."""
    tex = None
    for line in open(mhmat_path, encoding='utf-8', errors='ignore'):
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0] == 'diffuseTexture':
            tex = os.path.join(os.path.dirname(mhmat_path), parts[1].strip())
    if not tex or not os.path.exists(tex):
        raise FileNotFoundError(f'no diffuseTexture in {mhmat_path}')
    img = bpy.data.images.load(tex)
    if img.size[0] > max_size or img.size[1] > max_size:
        s = max_size / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
    img.file_format = 'JPEG'
    img.save(filepath=out_path, quality=85)
    bpy.data.images.remove(img)


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
    sizes = {'skin': 2048, 'hair': 1024, 'clothes': 1024, **fig.get('texture_sizes', {})}
    sizes.setdefault('parts', sizes['hair'])
    parts = []  # (kind, id, asset, object, size_key)
    slots = {}  # garment id -> clothing slot (top/bottom/full/shoes/hat)
    for part_type, subdir, name in [
        ('Eyes', 'eyes', fig.get('eyes')), ('Eyebrows', 'eyebrows', fig.get('eyebrows')), ('Eyelashes', 'eyelashes', fig.get('eyelashes')),
        ('Teeth', 'teeth', fig.get('teeth')), ('Tongue', 'tongue', fig.get('tongue')),
    ]:
        if not name:
            continue
        obj = HumanService.add_mhclo_asset(find_mhclo(name, subdir), basemesh, asset_type=part_type, subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=rig is not None)
        parts.append((part_type.lower(), name, name, obj, 'parts'))
    hairs = fig.get('hairs') or ([{'id': fig['hair'], 'asset': fig['hair']}] if fig.get('hair') else [])
    for h in hairs:
        obj = HumanService.add_mhclo_asset(find_mhclo(h['asset'], 'hair'), basemesh, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=rig is not None)
        if fig.get('hairs'):
            obj.name = f'hair_{h["id"]}'
        parts.append(('hair', h['id'], h['asset'], obj, 'hair'))
    for c in fig.get('clothes', []):
        entry = c if isinstance(c, dict) else {'id': c, 'asset': c}
        obj = HumanService.add_mhclo_asset(find_mhclo(entry['asset'], 'clothes'), basemesh, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=rig is not None)
        if isinstance(c, dict):
            obj.name = f'garment_{entry["id"]}'
            # each garment gets its own material copy so per-garment overrides don't leak (same asset used twice)
            for slot in obj.material_slots:
                if slot.material:
                    slot.material = slot.material.copy()
            apply_material_override(obj, entry)
        parts.append(('underwear' if entry.get('layer') == 'underwear' else 'clothes', entry['id'], entry['asset'], obj, 'clothes'))
        if entry.get('slot'):
            slots[entry['id']] = entry['slot']
    log(fig['name'], 'assets added', f'{time.time() - t0:.1f}s')
    # Garment "delete" masks: MPFB hides the body under each garment with a Mask modifier per
    # vertex group Delete.<asset>. All garments are exported together, so instead of applying the
    # masks (which would remove nearly the whole body) they become a per-vertex bitfield attribute
    # (_GARMENTMASKA bits 0-11, _GARMENTMASKB bits 12-23) and the runtime discards body fragments
    # under the garments actually worn (src/character/character.ts).
    mask_bits = {}
    if fig.get('hairs') or any(isinstance(c, dict) for c in fig.get('clothes', [])):
        n_verts = len(basemesh.data.vertices)
        mask_a = [0.0] * n_verts
        mask_b = [0.0] * n_verts
        bit = 0
        for kind, pid, asset, obj, _ in parts:
            if kind not in ('clothes', 'underwear'):
                continue
            vg = basemesh.vertex_groups.get('Delete.' + asset.replace(' ', '_'))
            mask_bits[pid] = bit
            if vg is not None:
                idx = vg.index
                for v in basemesh.data.vertices:
                    for g in v.groups:
                        if g.group == idx and g.weight > 0.0:
                            if bit < 12:
                                mask_a[v.index] += float(1 << bit)
                            else:
                                mask_b[v.index] += float(1 << (bit - 12))
                            break
            bit += 1
        for name, vals in (('_GARMENTMASKA', mask_a), ('_GARMENTMASKB', mask_b)):
            attr = basemesh.data.attributes.new(name, 'FLOAT', 'POINT')
            attr.data.foreach_set('value', vals)
        for m in list(basemesh.modifiers):
            if m.type == 'MASK' and str(m.vertex_group).startswith('Delete.'):
                basemesh.modifiers.remove(m)
        log(fig['name'], 'garment masks ->', len(mask_bits), 'bits; body masks removed')
    # legacy bake-off material overrides: {"asset name": {"color": [r,g,b,a]}}
    for kind, pid, asset, obj, _ in parts:
        override = fig.get('materials', {}).get(asset)
        if override and obj is not None:
            apply_material_override(obj, override)
    # texture budgets
    downscale_object_images(basemesh, sizes['skin'])
    for kind, pid, asset, obj, size_key in parts:
        if obj is not None:
            downscale_object_images(obj, sizes.get(size_key, 1024))
    # collect export selection
    objs = [basemesh] + [o for _, _, _, o, _ in parts if o is not None]
    if rig is not None:
        objs.append(rig)
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    lo, hi = measure_height(basemesh)
    height = hi - lo
    out = os.path.join(out_dir, fig['name'] + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_morph=False,
        export_skins=True, export_animations=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=85,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_attributes=True,
    )
    skins = {'base': fig.get('skin'), 'extra': {}}
    for key, skin_name in fig.get('skins_extra', {}).items():
        path = os.path.join(out_dir, f'{fig["name"]}.skin.{key}.jpg')
        export_skin_diffuse(find_mhmat(skin_name), path, sizes['skin'])
        skins['extra'][key] = os.path.basename(path)
        log(fig['name'], 'skin', key, os.path.basename(path), f'{os.path.getsize(path) / 1e6:.1f} MB')
    side = {
        'name': fig['name'], 'height': height, 'rig': fig.get('rig'),
        'bones': [b.name for b in rig.data.bones] if rig is not None else [],
        'parts': [{'kind': k, 'id': pid, 'asset': a, 'object': o.name if o is not None else None, **({'slot': slots[pid]} if pid in slots else {})} for k, pid, a, o, _ in parts],
        'skins': skins,
        'maskBits': mask_bits,
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
