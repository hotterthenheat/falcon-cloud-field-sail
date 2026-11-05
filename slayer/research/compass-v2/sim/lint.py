"""Static guard for strategy / frozen-spec source: the engine's API cannot return the future, so the only way to peek
is to go around it. This refuses source that does: importing the store or the engine internals, touching private
attributes (the context's mangled engine handle), reading files, or opening network connections.

    python3 -m sim.lint path/to/strategy.py      (exit 1 and the offending lines if any)
"""
from __future__ import annotations

import ast
import sys

FORBIDDEN_IMPORTS = {'data.store', 'data.fetch', 'data.clients', 'pyarrow', 'pyarrow.parquet', 'urllib', 'requests',
                     'socket', 'http', 'pickle', 'glob', 'shutil', 'subprocess', 'gc', 'inspect', 'ctypes'}
ALLOWED_FROM_STORE = {'Contract'}        # `from data.store import Contract` is fine (a value type)
FORBIDDEN_NAMES = {'open', 'eval', 'exec', '__import__', 'globals', 'vars', 'getattr', 'setattr', 'compile'}


def check_source(src: str, filename: str = '<strategy>') -> list[str]:
    bad = []
    tree = ast.parse(src, filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name in FORBIDDEN_IMPORTS or a.name.split('.')[0] in {'urllib', 'socket', 'http', 'subprocess'}:
                    bad.append(f'{filename}:{node.lineno}: import {a.name}')
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ''
            if mod == 'data.store' and all(a.name in ALLOWED_FROM_STORE for a in node.names):
                continue
            if mod in FORBIDDEN_IMPORTS or mod.split('.')[0] in {'urllib', 'socket', 'http', 'subprocess'}:
                bad.append(f'{filename}:{node.lineno}: from {mod} import ...')
        elif isinstance(node, ast.Attribute) and node.attr.startswith('_') and not (
                node.attr.startswith('__') and node.attr.endswith('__')):
            # self._x on the strategy's own object is fine; ctx._anything / pos._x / engine internals are not
            if not (isinstance(node.value, ast.Name) and node.value.id == 'self'):
                bad.append(f'{filename}:{node.lineno}: private attribute .{node.attr}')
        elif isinstance(node, ast.Attribute) and node.attr in ('__dict__', '__closure__', '__globals__', '__code__'):
            bad.append(f'{filename}:{node.lineno}: introspection .{node.attr}')
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            bad.append(f'{filename}:{node.lineno}: forbidden builtin {node.id}')
    return bad


def check_file(path: str) -> list[str]:
    return check_source(open(path, encoding='utf8').read(), path)


if __name__ == '__main__':
    problems = [p for f in sys.argv[1:] for p in check_file(f)]
    print('\n'.join(problems) or 'LINT OK')
    sys.exit(1 if problems else 0)
