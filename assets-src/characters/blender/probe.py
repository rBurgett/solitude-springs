# Prints where MPFB looks for data and which assets it currently sees. Used to verify the setup.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpfb_env import mpfb

LocationService = mpfb('mpfb.services.locationservice', 'LocationService')
AssetService = mpfb('mpfb.services.assetservice', 'AssetService')
print('user data dir:', LocationService.get_user_data())
print('data roots:', AssetService.get_available_data_roots())
for sub in ('skins', 'clothes', 'hair', 'eyes', 'eyebrows', 'eyelashes', 'teeth', 'tongue'):
    try:
        lst = AssetService.list_mhmat_assets(sub) if sub == 'skins' else AssetService.list_mhclo_assets(sub)
        print(f'{sub}: {len(lst)} assets')
    except Exception as e:  # noqa: BLE001
        print(f'{sub}: error {e}')
