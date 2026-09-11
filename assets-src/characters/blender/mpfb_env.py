# Shared import shim for MPFB services (extensions have unknown absolute package names).
import importlib
import sys


def mpfb(module_suffix: str, attr: str):
    for name in list(sys.modules):
        if name.endswith(module_suffix):
            mod = importlib.import_module(name)
            if not hasattr(mod, attr):
                raise AttributeError(f'{name} has no attribute {attr}')
            return getattr(mod, attr)
    raise ImportError(f'MPFB module ending in {module_suffix} is not loaded; is the extension enabled?')
