# Lists every MPFB asset visible in the configured data roots, grouped by type, so the
# generator can reference exact file names.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpfb_env import mpfb

AssetService = mpfb('mpfb.services.assetservice', 'AssetService')
AssetService.update_all_asset_lists()
for sub in ('skins', 'clothes', 'hair', 'eyes', 'eyebrows', 'eyelashes', 'teeth', 'tongue', 'proxymeshes'):
    try:
        lst = AssetService.list_mhmat_assets(sub) if sub == 'skins' else AssetService.list_mhclo_assets(sub)
    except Exception as e:  # noqa: BLE001
        print(f'== {sub}: error {e}')
        continue
    names = sorted(a.get('basename', a.get('label', '?')) if isinstance(a, dict) else str(a) for a in (lst.values() if isinstance(lst, dict) else lst))
    print(f'== {sub} ({len(names)}):')
    print('   ' + ', '.join(names))
