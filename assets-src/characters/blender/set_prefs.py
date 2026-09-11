# One-off: point MPFB's user-data directory at a repo-local, git-ignored folder so asset packs
# and generated characters live with the project (plan §4.5). Run once:
#   flatpak run org.blender.Blender --background --python assets-src/characters/blender/set_prefs.py -- <abs path>
import sys
import bpy

path = sys.argv[sys.argv.index('--') + 1]
prefs = bpy.context.preferences
keys = [k for k in prefs.addons.keys() if k.endswith('.mpfb')]
if not keys:
    raise SystemExit('MPFB is not enabled in these preferences')
ap = prefs.addons[keys[0]].preferences
ap.mpfb_user_data = path
bpy.ops.wm.save_userpref()
print('MPFB addon module:', keys[0])
print('MPFB user data ->', ap.mpfb_user_data)
