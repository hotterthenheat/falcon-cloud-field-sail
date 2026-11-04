#!/usr/bin/env python3
"""Two sectors from the Compass record. Nothing here changes a live rule.

  Taken   every closed call, every model: why the rule fired, the fill, the exit,
          and whether the peak bid would have paid more. That last number is hindsight.
  Missed  every mover already on a study file: the first gate that said no.

  python3 research/study/sectors.py
  python3 research/study/sectors.py /path/to/.cache/compass

Writes <dir>/study/sectors.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def why_taken(call: dict) -> str:
    book = call.get("book")
    right = call.get("right")
    p1 = call.get("p1")
    prun = call.get("prun")
    if book == "R":
        if right == "C":
            return "The close broke under the last 30 closes. Tail risk bought the call. No stop. The rule sells the bid when the close comes back through that low."
        return "The close broke above the last 30 closes. Tail risk bought the put. No stop. The rule sells the bid when the close comes back through that high."
    if book == "C":
        return "Book C. No model score. 3× inside 120 seconds, or 2× inside 30 seconds. Flat at 15:50."
    if book == "B" or call.get("runner"):
        extra = f"Model 2 {prun * 100:.0f}%. " if isinstance(prun, (int, float)) else ""
        return f"Book {book}. {extra}The stop ratchets. Flat at 15:55."
    extra = f"Model 1 {p1 * 100:.1f}%. " if isinstance(p1, (int, float)) else ""
    return f"Book A. {extra}Out at 1.50× the ask, or the stop at 0.4678× the fill."


def signed(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}{abs(v):.1f}%"


def left_on_table(call: dict) -> str:
    outcome = call.get("outcome") or {}
    fill = (outcome.get("fill") or {}).get("ask")
    exit_ = outcome.get("exit") or {}
    peak = outcome.get("peak")
    status = outcome.get("status")
    if status == "unavailable":
        return "No quote a minute later. Never filled."
    if status != "closed" or not exit_ or not isinstance(fill, (int, float)) or fill <= 0:
        return "Still open. No hindsight until it closes."
    px = exit_.get("px")
    why = exit_.get("why") or "the exit"
    if not isinstance(peak, (int, float)) or not isinstance(px, (int, float)) or peak <= fill:
        return f"Left on {why}. The exit was the best bid read."
    held = (peak - fill) / fill * 100
    got = (px - fill) / fill * 100
    return f"Left on {why}. Hindsight only: the bid later reached {peak:.2f}, {signed(held)} instead of {signed(got)}. The live rule is not changed."


def catch_line(gate: str) -> str:
    lines = {
        "Model 1 under the threshold": "Model 1 was under the bar. Catching it means lowering that bar. Not applied.",
        "outside the books’ strike band": "The strike sat outside the book. Catching it means a wider band. Not applied.",
        "seats full": "The book already held its seats. Catching it means another open ticket. Not applied.",
        "theta burns the stop before the flat": "Decay would have eaten the stop before the flat. The rule stood aside. Not applied.",
        "side or drive rule": "The side or the drive rule said no. Catching it means dropping that rule. Not applied.",
        "bid at or under $0.15": "The bid was at or under $0.15. The book does not buy that. Not applied.",
        "spread over 8%": "The spread was over 8% of the ask. Catching it means paying a wider market. Not applied.",
        "called": "This one was a call.",
        "would have called (late mark)": "This one was a call.",
    }
    if gate in lines:
        return lines[gate]
    if gate.startswith("not scored"):
        return f"{gate}. The scan never had a row to fire from. Not applied."
    return f"The first gate was “{gate}”. That is the rule that said no. Not applied."


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / ".cache" / "compass")
    taken = []
    missed = []
    for path in sorted(root.glob("20*.json")):
        doc = load_json(path)
        if not doc:
            continue
        day = doc.get("day") or path.stem
        for call in doc.get("calls") or []:
            if call.get("would"):
                continue
            outcome = call.get("outcome") or {}
            fill = (outcome.get("fill") or {}).get("ask")
            exit_px = (outcome.get("exit") or {}).get("px")
            taken.append({
                "day": day,
                "contract": call.get("contract"),
                "book": call.get("book"),
                "why": why_taken(call),
                "fill": fill,
                "exit": exit_px,
                "exitWhy": (outcome.get("exit") or {}).get("why"),
                "peak": outcome.get("peak"),
                "pnl": outcome.get("pnl"),
                "hindsight": left_on_table(call),
            })
    study_dir = root / "study"
    if study_dir.is_dir():
        for path in sorted(study_dir.glob("20*.json")):
            doc = load_json(path)
            if not doc:
                continue
            day = doc.get("day") or path.stem
            for mover in doc.get("movers") or []:
                gate = mover.get("gate") or ""
                if gate in ("called", "would have called (late mark)"):
                    continue
                missed.append({
                    "day": day,
                    "contract": mover.get("contract"),
                    "sleeve": mover.get("sleeve"),
                    "ratio": mover.get("ratio"),
                    "ask": mover.get("ask"),
                    "bestBid": mover.get("bestBid"),
                    "gate": gate,
                    "how": catch_line(gate),
                })
    out = {
        "taken": taken,
        "missed": missed,
        "note": "Hindsight on a taken trade, and the first gate on a missed mover. Neither is applied to a live model.",
    }
    dest = study_dir / "sectors.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out))
    print(f"wrote {dest}  taken {len(taken)}  missed {len(missed)}")


if __name__ == "__main__":
    main()
