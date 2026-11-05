"""Minimal test runner (no pytest on this machine): python3 -m tests.run [pattern]"""
import importlib
import pkgutil
import sys
import traceback

import tests

pat = sys.argv[1] if len(sys.argv) > 1 else ''
fails = n = 0
for m in pkgutil.iter_modules(tests.__path__):
    if not m.name.startswith('test_'):
        continue
    mod = importlib.import_module(f'tests.{m.name}')
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
