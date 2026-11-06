"""Test runner (no pytest here): python3 -m etests.run [pattern]   (from slayer/research/ema-mtf)"""
import importlib
import pkgutil
import sys
import traceback

import etests

pat = sys.argv[1] if len(sys.argv) > 1 else ''
fails = n = 0
for m in pkgutil.iter_modules(etests.__path__):
    if not m.name.startswith('test_'):
        continue
    mod = importlib.import_module(f'etests.{m.name}')
    for name in sorted(dir(mod)):
        if name.startswith('test_') and pat in name and callable(getattr(mod, name)):
            n += 1
            try:
                getattr(mod, name)()
                print(f'ok    {m.name}.{name}')
            except Exception:  # noqa: BLE001
                fails += 1
                print(f'FAIL  {m.name}.{name}')
                traceback.print_exc()
print(f'{n - fails}/{n} passed')
sys.exit(1 if fails else 0)
