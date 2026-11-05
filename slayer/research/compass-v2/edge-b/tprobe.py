"""Locked one-off terminal probe: python3 tprobe.py /path k=v ... (prints head of the CSV)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import theta_csv  # noqa: E402

p = dict(a.split('=', 1) for a in sys.argv[2:])
df = theta_csv(sys.argv[1], p)
print(df.shape)
print(df.head(8).to_string())
print(df.tail(3).to_string())
