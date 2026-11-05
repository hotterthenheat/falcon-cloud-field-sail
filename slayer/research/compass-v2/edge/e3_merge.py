"""Merge the two E3 DEV workers' records (forward: E3_DEV.json up to 2023-08; reverse: E3_DEV_b.json from 2023-09)
and print the E3 report."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import hyp

R = os.path.join(sim.ROOT, 'results')
a = json.load(open(os.path.join(R, 'E3_DEV.json')))
b = json.load(open(os.path.join(R, 'E3_DEV_b.json')))
cut = '2023-09-01'
m = {k: v for k, v in a.items() if k.split('|')[1] < cut}
m.update({k: v for k, v in b.items() if k.split('|')[1] >= cut})
json.dump(m, open(os.path.join(R, 'E3_DEV.json'), 'w'))
print(len(a), len(b), '->', len(m))
print(hyp.report('E3', 'DEV', m)[0])
