"""One factual SPX book for Terrain. No fills. Writes theta/cache/spx-book.json."""
import json, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BASE = "http://127.0.0.1:25503/v3"
NY = ZoneInfo("America/New_York")
OUT = "/workspace/slayer/theta/cache/spx-book.json"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=120) as r:
        return json.loads(r.read().decode())


def rows(path):
    data = get(path)
    return data.get("response") or []


def ny_sec(stamp):
    if not stamp:
        return 0
    stamp = stamp.split(".")[0]
    day, time = stamp.split("T")
    y, m, d = (int(x) for x in day.split("-"))
    hh, mm, ss = (int(x) for x in time.split(":"))
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=NY).timestamp())


def ymd(dt):
    return dt.strftime("%Y%m%d")


def bars_of(items, keys=("open", "high", "low", "close")):
    out = []
    for b in items:
        t = ny_sec(b.get("timestamp") or b.get("last_trade") or b.get("created"))
        o, h, l, c = (float(b.get(k) or 0) for k in keys)
        if t > 0 and h > 0 and l > 0 and c > 0:
            out.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": float(b.get("volume") or 0)})
    out.sort(key=lambda x: x["time"])
    return out


def chain(exp):
    greeks = rows(f"/option/snapshot/greeks/second_order?symbol=SPXW&expiration={exp}&format=json")
    oi = rows(f"/option/snapshot/open_interest?symbol=SPXW&expiration={exp}&format=json")
    oi_map = {}
    oi_asof = ""
    for item in oi:
        c = item["contract"]
        d = item["data"][0]
        oi_map[(c["strike"], c["right"])] = int(d.get("open_interest") or 0)
        oi_asof = d.get("timestamp") or oi_asof
    by = {}
    spot = 0
    quote = ""
    for item in greeks:
        c = item["contract"]
        d = item["data"][0]
        k = float(c["strike"])
        row = by.setdefault(k, {"strike": k})
        side = "call" if c["right"] == "CALL" else "put"
        row[side] = {
            "gamma": float(d.get("gamma") or 0),
            "iv": float(d.get("implied_vol") or 0),
            "oi": oi_map.get((c["strike"], c["right"]), 0),
            "bid": float(d.get("bid") or 0),
            "ask": float(d.get("ask") or 0),
        }
        px = float(d.get("underlying_price") or 0)
        if px > 0:
            spot = px
        quote = d.get("underlying_timestamp") or quote
    strikes = [by[k] for k in sorted(by)]
    return {"expiration": f"{exp[:4]}-{exp[4:6]}-{exp[6:]}", "spot": spot, "quoteAt": quote, "oiAt": oi_asof, "strikes": strikes}


def atm_iv(day, close):
    strike = int(round(close / 5.0) * 5)
    path = (
        f"/option/history/greeks/eod?symbol=SPXW&expiration={day}&strike={strike}"
        f"&right=call&start_date={day}&end_date={day}&format=json"
    )
    try:
        got = rows(path)
    except Exception:
        return None
    if not got or not got[0].get("data"):
        return None
    iv = float(got[0]["data"][-1].get("implied_vol") or 0)
    return iv if iv > 0 else None


def flow_day(day):
    """Sum every SPXW print that day into one-minute premium. RTH only."""
    minutes = {}
    start = datetime.strptime("09:30", "%H:%M")
    for i in range(26):
        a = (start + timedelta(minutes=15 * i)).strftime("%H:%M:%S")
        b = (start + timedelta(minutes=15 * (i + 1))).strftime("%H:%M:%S")
        if b > "16:00:00":
            b = "16:00:00"
        path = (
            f"/option/history/trade?symbol=SPXW&expiration={day}&start_date={day}&end_date={day}"
            f"&start_time={a}&end_time={b}&format=json"
        )
        print("flow", day, a, flush=True)
        try:
            got = rows(path)
        except Exception as e:
            print("flow fail", a, e, flush=True)
            continue
        for item in got:
            right = item["contract"]["right"]
            for p in item["data"]:
                px = float(p.get("price") or 0)
                sz = float(p.get("size") or 0)
                if px <= 0 or sz <= 0:
                    continue
                sec = ny_sec(p.get("timestamp"))
                if sec <= 0:
                    continue
                minute = sec - (sec % 60)
                slot = minutes.setdefault(minute, {"time": minute, "call": 0.0, "put": 0.0, "callSize": 0, "putSize": 0})
                dollars = px * sz * 100
                if right == "CALL":
                    slot["call"] += dollars
                    slot["callSize"] += sz
                elif right == "PUT":
                    slot["put"] += dollars
                    slot["putSize"] += sz
        if b == "16:00:00":
            break
    return [minutes[k] for k in sorted(minutes)]


def main():
    now = datetime.now(NY)
    today = ymd(now)
    yest = ymd(now - timedelta(days=1))
    # Monday's session if yesterday was Sunday
    probe = now - timedelta(days=1)
    while probe.weekday() >= 5:
        probe -= timedelta(days=1)
    yest = ymd(probe)
    year = ymd(now - timedelta(days=360))
    print("window", yest, today, flush=True)

    m1 = bars_of(rows(f"/index/history/ohlc?symbol=SPX&start_date={yest}&end_date={today}&interval=1m&format=json"))
    print("1m", len(m1), flush=True)
    raw_1s = rows(f"/index/history/ohlc?symbol=SPX&start_date={yest}&end_date={yest}&interval=1s&format=json")
    sec = bars_of(raw_1s)
    s15 = []
    for b in sec:
        bucket = b["time"] - (b["time"] % 15)
        if not s15 or s15[-1]["time"] != bucket:
            s15.append({**b, "time": bucket})
        else:
            cur = s15[-1]
            cur["high"] = max(cur["high"], b["high"])
            cur["low"] = min(cur["low"], b["low"])
            cur["close"] = b["close"]
            cur["volume"] += b["volume"]
    print("15s", len(s15), flush=True)

    daily = bars_of(rows(f"/index/history/eod?symbol=SPX&start_date={year}&end_date={today}&format=json"))
    vix = bars_of(rows(f"/index/history/eod?symbol=VIX&start_date={year}&end_date={today}&format=json"))
    print("daily", len(daily), "vix", len(vix), flush=True)

    expirations = ["20261027", "20261028", "20261030"]
    # keep them dated from the clock, not a hard code, if those days have passed the list
    fut = [e["expiration"].replace("-", "") for e in rows("/option/list/expirations?symbol=SPXW&format=json") if e["expiration"] >= now.strftime("%Y-%m-%d")]
    pick = []
    for e in fut:
        if e >= today:
            pick.append(e)
        if len(pick) >= 8:
            break
    # front, the next session, and the Friday of this week if present
    wanted = []
    if pick:
        wanted.append(pick[0])
    if len(pick) > 1:
        wanted.append(pick[1])
    friday = None
    for e in pick:
        dt = datetime.strptime(e, "%Y%m%d")
        if dt.weekday() == 4:
            friday = e
            break
    if friday and friday not in wanted:
        wanted.append(friday)
    print("expiries", wanted, flush=True)
    chains = [chain(e) for e in wanted]

    closes = vix[-252:] if len(vix) > 252 else vix
    ivs = [b["close"] for b in closes if b["close"] > 0]
    rank = None
    if len(ivs) >= 20:
        lo, hi, last = min(ivs), max(ivs), ivs[-1]
        rank = (last - lo) / (hi - lo) if hi > lo else None
    iv_rank = {
        "source": "VIX close, the 30-day implied of SPX",
        "sessions": len(ivs),
        "last": ivs[-1] if ivs else None,
        "low": min(ivs) if ivs else None,
        "high": max(ivs) if ivs else None,
        "rank": rank,
        "from": datetime.fromtimestamp(closes[0]["time"], NY).date().isoformat() if closes else None,
        "to": datetime.fromtimestamp(closes[-1]["time"], NY).date().isoformat() if closes else None,
    }

    score = []
    for b in daily[-25:]:
        day = datetime.fromtimestamp(b["time"], NY).strftime("%Y%m%d")
        if day >= today:
            continue
        iv = atm_iv(day, b["close"])
        if not iv:
            continue
        band = b["open"] * iv * (1 / 252) ** 0.5
        inside = abs(b["close"] - b["open"]) <= band if band > 0 else None
        score.append({"day": day, "open": b["open"], "close": b["close"], "iv": iv, "band": band, "inside": inside})
        print("score", day, iv, inside, flush=True)
        if len(score) >= 20 and score[0]["day"] < day:
            pass
    score = score[-20:]

    print("flow start", yest, flush=True)
    partial = {
        "symbol": "SPX",
        "option": "SPXW",
        "builtAt": now.isoformat(),
        "minute": m1,
        "sec15": s15,
        "daily": daily,
        "chains": chains,
        "ivRank": iv_rank,
        "scorecard": score,
        "flow": None,
        "sign": "call gamma is negative and put gamma is positive, the house sign",
    }
    import os
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(partial, f, separators=(",", ":"))
    print("partial", OUT, flush=True)
    prints = flow_day(yest)
    partial["flow"] = {"day": yest, "minutes": prints}
    partial["builtAt"] = datetime.now(NY).isoformat()
    with open(OUT, "w") as f:
        json.dump(partial, f, separators=(",", ":"))
    print("wrote", OUT, "flow minutes", len(prints), "score", len(score), flush=True)


if __name__ == "__main__":
    main()
