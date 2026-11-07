"""Mutation check (spec §7 Test 6): inject each listed bug into a COPY of ref60.py and confirm the audit
suite (run_tests.py) fails. Copies are written to a temp directory; ref60.py is never modified.

  python3 mutation_check.py [outdir]
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile

import run_tests

HERE = os.path.dirname(os.path.abspath(__file__))

# (name, [(old, new, expected_count)])
MUTATIONS = [
    ("color missing (b-r)", [("color_T = gamma * ((b - r) + (d1 * d2 - 1) / (2 * T) - b * d1 / vs)",
                              "color_T = gamma * ((d1 * d2 - 1) / (2 * T) - b * d1 / vs)", 1)]),
    ("veta (1 - d1*d2)", [("(1 + d1 * d2) / (2 * T)", "(1 - d1 * d2) / (2 * T)", 1)]),
    ("charm sign", [("charm = -ec * (", "charm = ec * (", 2)]),
    ("charm without carry term", [("charm = -ec * (ph * dd1dT + (b - r) * N(B, d1))", "charm = -ec * (ph * dd1dT)", 1),
                                  ("charm = -ec * (ph * dd1dT - (b - r) * N(B, -d1))", "charm = -ec * (ph * dd1dT)", 1)]),
    ("speed sign", [("speed = -gamma / S * (1 + d1 / vs)", "speed = gamma / S * (1 + d1 / vs)", 1)]),
    ("zomma (d1*d2 + 1)", [("zomma = gamma * (d1 * d2 - 1) / sig", "zomma = gamma * (d1 * d2 + 1) / sig", 1)]),
    ("vanna with d1", [("vanna = -ec * ph * d2 / sig", "vanna = -ec * ph * d1 / sig", 1)]),
    ("COLOR without minus", [('"COLOR": -g["color_T"]', '"COLOR": g["color_T"]', 1)]),
    ("CHARM with extra minus", [('"CHARM": g["charm"]', '"CHARM": -g["charm"]', 1)]),
    ("VANNA without S", [('"VANNA": g["vanna"] * C * M * S * pct', '"VANNA": g["vanna"] * C * M * pct', 1)]),
    ("Model 2 buy sign", [('    if px >= ask:\n        return "BUY", -size', '    if px >= ask:\n        return "BUY", +size', 1)]),
    ("UW DEX without put flip", [('"DEX": (cd - pd) * 100 / S', '"DEX": (cd + pd) * 100 / S', 1)]),
]


def load_copy(src_text, name, outdir):
    path = os.path.join(outdir, f"{name}.py")
    with open(path, "w") as f:
        f.write(src_text)
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(outdir=None):
    outdir = outdir or tempfile.mkdtemp(prefix="twobook_mut_")
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(HERE, "ref60.py")) as f:
        clean = f.read()
    results = []
    for i, (name, patches) in enumerate(MUTATIONS):
        src = clean
        for old, new, cnt in patches:
            n = src.count(old)
            if n != cnt:
                raise SystemExit(f"mutation {name!r}: pattern found {n} times, expected {cnt}")
            src = src.replace(old, new)
        mod = load_copy(src, f"ref60_mut{i:02d}", outdir)
        res = run_tests.run_all(mod, verbose=False)
        caught_by = [t for t, fl in res.items() if fl]
        results.append({"mutation": name, "caught": bool(caught_by), "caught_by": caught_by,
                        "first_failures": {t: fl[:2] for t, fl in res.items() if fl}})
        print(f"{name:28s} {'CAUGHT' if caught_by else 'MISSED'} by {caught_by}", flush=True)
    # control: an unmodified copy must pass
    ctrl = run_tests.run_all(load_copy(clean, "ref60_control", outdir), verbose=False)
    control_ok = not any(ctrl.values())
    print("control (unmodified copy) passes:", control_ok)
    summary = {"caught": sum(r["caught"] for r in results), "total": len(results), "control_passes": control_ok,
               "results": results}
    with open(os.path.join(HERE, "results_mutation.json"), "w") as f:
        json.dump(summary, f, indent=1)
    print(f"{summary['caught']}/{summary['total']} caught")
    return summary


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
