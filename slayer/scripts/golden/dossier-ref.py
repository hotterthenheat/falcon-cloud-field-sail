# The Dossier golden test's expected values, recomputed from the raw fixture rows with plain arithmetic (no app code):
# each block restates the rule the page uses, in its own words, and prints the figures dossier-golden.ts checks.
# Run: python -I scripts/golden/dossier-ref.py scripts/fixtures/golden/dossier-2026-10-29
import gzip, json, os, sys
from statistics import mean

root = sys.argv[1]
ans = {}
for f in os.listdir(root):
    if f.endswith('.json.gz'):
        saved = json.loads(gzip.open(os.path.join(root, f)).read())
        body = json.loads(saved['body'])
        ans[saved['path']] = body['data'] if isinstance(body, dict) and 'data' in body else body

def n(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

clamp = lambda v, lo=-1, hi=1: max(lo, min(hi, v))
TODAY = '2026-10-29'  # the recording instant is 07:32 ET, before the open

def closes_of(t):
    rows = ans[f'/stock/{t}/ohlc/1d?limit=18']
    by = {}
    for r in rows:
        if (r.get('market_time') or 'r') == 'r' and n(r.get('close')):
            by[r['date']] = n(r['close'])
    return sorted(by.items(), reverse=True)

# ---- 1. the read: trend, numbers, money off the screener row; composite over the pillars in the read ----
for t in ['NVDA', 'GME']:
    row = [r for r in ans[f'/screener/stocks?ticker={t}'] if r['ticker'] == t][0]
    cl = closes_of(t)
    # the row is dated the last session (not today): its regular price is that session's regular close
    last = dict(cl)[row['date']]
    f = []
    off = (last - n(row['ema_20'])) / n(row['ema_20']) * 100
    f.append((clamp(off / 3), .3))
    f.append((clamp((n(row['rsi_14']) - 50) / 20), .2))
    week = last / n(row['one_week_close']) - 1
    f.append((clamp(max(0, n(row['adx_14']) - 20) / 20 * (1 if week >= 0 else -1)), .2))
    month = last / n(row['one_month_close']) - 1
    f.append((clamp(month * 100 / 8), .1))
    score = lambda fs: round(50 + 50 * sum(l * w for l, w in fs) / sum(w for _, w in fs))
    trend = score(f)
    # numbers: each span's change as a rate a year; the one nearest zero when all share a sign
    spans = [(1, n(row['eps_growth_4q'])), (2, n(row['eps_growth_8q'])), (3, n(row['eps_growth_12q']))]
    rates = [(1 + g) ** (1 / y) - 1 for y, g in spans if g is not None and 1 + g > 0]
    rate = min(rates) if all(r >= 0 for r in rates) else max(rates) if all(r <= 0 for r in rates) else 0
    nf = [(clamp(rate / .25), .7 if len(rates) >= 2 else .35), (clamp(-n(row['shares_outstanding_growth_4q']) / .05), .3)]
    numbers = score(nf)
    # money: the row is a full day (not today's): relative volume is the vendor's; it leans only at 1.3x+ with the side
    bull, bear = n(row['bullish_premium']), n(row['bearish_premium'])
    side = bull / (bull + bear)
    side_dir = 0 if abs(side - .5) < .05 else (1 if side > .5 else -1)
    calls, puts = n(row['call_premium']), n(row['put_premium'])
    share = calls / (calls + puts)
    prem_dir = 0 if abs(share - .5) < .05 else (1 if share > .5 else -1)
    rv = n(row['relative_volume'])
    up = n(row['one_day_perc']) >= 0
    rv_lean = clamp((rv - 1) * (1 if up else -1)) if rv >= 1.3 else 0
    if rv_lean and not (side_dir and (rv_lean > 0) == (side_dir > 0)):
        rv_lean = 0
    mf = [(rv_lean, .25), (0 if side_dir == 0 else clamp((side - .5) * 4), .3), (clamp((share - .5) * 4) if prem_dir and prem_dir == side_dir else 0, .15)]
    money_in = bull + bear >= 1e6
    money = score(mf)
    w = {'trend': .32, 'numbers': .24, 'money': .26}
    parts = [('trend', trend), ('numbers', numbers)] + ([('money', money)] if money_in else [])
    comp = round(sum(w[k] * s for k, s in parts) / sum(w[k] for k, _ in parts))
    grade = 'strong' if comp >= 72 else 'good' if comp >= 60 else 'poor' if comp <= 46 else 'caution'
    print(t, 'read', dict(trend=trend, numbers=numbers, money=money, money_in=money_in, composite=comp, grade=grade, rate=round(rate, 4)))

# ---- 2. earnings: the upcoming report's implied move; the usual move over the last eight reports with a move ----
def cents(v):
    return round(v * 100)
for t in ['NVDA', 'GME']:
    rows = ans[f'/earnings/{t}']
    upcoming = sorted([r for r in rows if r['report_date'] >= TODAY and r.get('actual_eps') in (None, '')], key=lambda r: r['report_date'])[0]
    implied = abs(n(upcoming.get('expected_move_perc')) or 0) * 100
    past = sorted([r for r in rows if r['report_date'] < upcoming['report_date']], key=lambda r: r['report_date'], reverse=True)
    moved = [r for r in past if n(r.get('post_earnings_move_1d')) is not None][:8]
    usual = mean(abs(n(r['post_earnings_move_1d'])) * 100 for r in moved)
    eps = [r for r in past if n(r.get('actual_eps')) is not None and n(r.get('street_mean_est')) is not None][:8]
    res = ['beat' if cents(n(r['actual_eps'])) > cents(n(r['street_mean_est'])) else 'miss' if cents(n(r['actual_eps'])) < cents(n(r['street_mean_est'])) else 'inline' for r in eps]
    priced = [r for r in moved if (n(r.get('expected_move_perc')) or 0) > 0]
    inside = sum(1 for r in priced if abs(n(r['post_earnings_move_1d'])) <= abs(n(r['expected_move_perc'])))
    ups = sum(1 for r in moved if n(r['post_earnings_move_1d']) > 0)
    print(t, 'earnings', dict(iso=upcoming['report_date'], implied=round(implied, 4), usual=round(usual, 4), n=len(moved), richness=round(implied / usual, 4) if implied > 0 and len(moved) >= 4 else 0,
                              beat=res.count('beat'), inline=res.count('inline'), miss=res.count('miss'), inside=(inside, len(priced)), up=(ups, len(moved))))

# ---- 3. insiders: Form 144 and unnamed codes out; open-market non-share lines and impossible prices set aside ----
NOT_SHARES = ['swap', 'preferred', 'warrant', 'option', 'note', 'debenture', 'bond', 'right', 'unit', 'convertible', 'derivative', 'future', 'restricted stock unit', 'rsu', 'phantom', 'performance share']
import re
NS = re.compile(r'swap|preferred|\bpref\b|warrant|option|\bnotes?\b|debenture|\bbonds?\b|\bright(s)?\b|\bunits?\b|convertible|derivative|futures?|\bsafe\b|restricted stock unit|\brsus?\b|phantom|performance share', re.I)
def insiders(rows):
    kept, not_shares, implausible = [], 0, 0
    for r in rows:
        form = str(r.get('formtype') or '')
        code = (r.get('transaction_code') or '').upper()
        if form.startswith('144') or code not in 'PSAMFGD' or not code:
            continue
        market = code in 'PS'
        if market and r.get('security_title') and NS.search(r['security_title']):
            not_shares += 1
            continue
        shares, price, spot, cap = abs(n(r.get('amount')) or 0), n(r.get('price')) or 0, n(r.get('stock_price')) or 0, n(r.get('marketcap')) or 0
        if market and spot > 0 and price > 0 and (price > spot * 10 or price * 10 < spot):
            implausible += 1
            continue
        if market and cap > 0 and shares * price > cap * .25:
            implausible += 1
            continue
        kept.append(r)
    # one trade, one row: same name, day, code and size, and the same filing (a joint owner or a twin), or a 4/A of it
    groups = []
    for r in kept:
        key = (r['ticker'], (r.get('transaction_date') or r.get('filing_date') or '')[:10], r['transaction_code'], abs(n(r.get('amount')) or 0))
        indirect = str(r.get('director_indirect') or '').upper() == 'I'
        ent = bool(r.get('reporter_is_public_company') in (True, 'true')) or bool(re.search(r'\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.?l\.?c|lp|l\.?p|llp|plc|ag|sa|s\.a|nv|n\.v|se|gmbh|bv|ab|asa|oyj|spa|kk|holdings?|group|partners(?:hip)?|capital|fund|funds|trust|management|advisors?|investments?|ventures|aggregator|foundation|bank|financial|securities)\.?\b', r.get('owner_name') or '', re.I))
        cik = (r.get('reporter_cik') or '').strip()
        amended = bool(re.search(r'/A$', str(r.get('formtype') or ''), re.I))
        price = n(r.get('price')) or 0
        hit = None
        for g in groups:
            if g['key'] != key:
                continue
            same = bool(cik) and cik in g['ciks']
            joint = g['filed'] == r['filing_date'] and abs(g['price'] - price) < 1e-6 and r['owner_name'] not in g['owners'] and (g['shared'] or indirect or ent)
            amend = same and (amended or g['amended']) and g['filed'] != r['filing_date']
            twin = (same or r['owner_name'] in g['owners']) and g['filed'] == r['filing_date'] and abs(g['price'] - price) < 1e-6 and g['after'] == (n(r.get('shares_owned_after')) or 0)
            if joint or amend or twin:
                hit = g
                break
        if hit is None:
            groups.append(dict(key=key, filed=r['filing_date'], price=price, owners={r['owner_name']}, ciks={cik} if cik else set(), shared=indirect or ent, amended=amended, after=n(r.get('shares_owned_after')) or 0, r=r))
            continue
        hit['owners'].add(r['owner_name'])
        if cik:
            hit['ciks'].add(cik)
        hit['amended'] = hit['amended'] or amended
        if r['filing_date'] > hit['filed']:
            hit.update(filed=r['filing_date'], price=price, after=n(r.get('shares_owned_after')) or 0, r=r)
    trades = [g['r'] for g in groups]
    market = [r for r in trades if r['transaction_code'] in 'PS']
    val = lambda r: round(abs(n(r.get('amount')) or 0) * (n(r.get('price')) or 0))
    return dict(raw=len(rows), trades=len(trades), merged=len(kept) - len(groups), notShares=not_shares, implausible=implausible, market=len(market),
                bought=sum(val(r) for r in market if r['transaction_code'] == 'P'), sold=sum(val(r) for r in market if r['transaction_code'] == 'S'))
for t in ['NVDA', 'GME']:
    print(t, 'insiders', insiders(ans[f'/insider/transactions?ticker_symbol={t}']))
print('market insiders', insiders(ans['/insider/transactions?limit=500&page=0']))

# ---- 4. congress: NVDA's members' reports (executive-branch filings left out) traded in the last 365 days; each
#      bracket's low and high summed ----
BR = [(1001, 15000), (15001, 50000), (50001, 100000), (100001, 250000), (250001, 500000), (500001, 1000000), (1000001, 5000000), (5000001, 25000000), (25000001, 50000000), (50000001, None)]
rows = [r for r in ans['/congress/recent-trades?ticker=NVDA&limit=200'] if (r.get('ticker') or '').upper() == 'NVDA' and (r.get('member_type') or '').lower() != 'executive']
from datetime import date
d = lambda s: date.fromisoformat(s[:10])
year = [r for r in rows if r.get('transaction_date') and (d(TODAY) - d(r['transaction_date'])).days <= 365]
lo, hi = 0, 0
for r in year:
    a = str(r.get('amounts') or '')
    over = re.search(r'\b(?:over|above|more than|greater than)\s*\$?\s*([0-9][0-9,]*)', a, re.I)
    low = int(over.group(1).replace(',', '')) + 1 if over else int(re.findall(r'([0-9][0-9,]*)', a)[0].replace(',', ''))
    b = [i for i, (l, h) in enumerate(BR) if low >= l and (h is None or low <= h)][0]
    lo += low if over else BR[b][0]
    hi = None if hi is None or BR[b][1] is None or over else hi + BR[b][1]
lags = sorted((d(r['filed_at_date']) - d(r['transaction_date'])).days for r in year)
print('congress NVDA', dict(raw=len(ans['/congress/recent-trades?ticker=NVDA&limit=200']), nvda=len(rows), year=len(year), low=lo, high=hi,
                            purchases=sum(1 for r in year if 'buy' in str(r.get('txn_type')).lower() or 'purchase' in str(r.get('txn_type')).lower()), late=sum(1 for l in lags if l > 45), medianLag=lags[len(lags) // 2]))

# ---- 5. shorts: GME's newest settlement, the change in shares short from the one before ----
s = sorted(ans['/short_screener?tickers=GME&order_by=market_date&order_direction=desc&limit=2'], key=lambda r: r['market_date'], reverse=True)
a, b = s[0], s[1]
print('shorts GME', dict(rows=len(s), date=a['market_date'], interest=round(n(a['si_float']) * 100, 4), dtc=n(a['days_to_cover']), fee=n(a.get('fee_rate')), available=n(a.get('short_shares_available')),
                         floatM=round(n(a['total_float']) / 1e6, 4), change=round((n(a['short_interest']) - n(b['short_interest'])) / n(b['short_interest']) * 100, 1)))

# ---- 6. the day: before the open the change is the last session's close against the one before; pre-market apart ----
for t in ['NVDA', 'GME']:
    cl = closes_of(t)
    st = ans[f'/stock/{t}/stock-state']
    sessions = [c for c in cl if c[0] < TODAY]
    day = (sessions[0][1] - sessions[1][1]) / sessions[1][1] * 100
    ext = (n(st['close']) - sessions[0][1]) / sessions[0][1] * 100
    row = ans[f'/screener/stocks?ticker={t}'][0]
    print(t, 'day', dict(mt=st['market_time'], dayPct=round(day, 4), extPct=round(ext, 4), screenRegular=sessions[0][1], screenExt=n(row['close']), screenExtPct=round((n(row['close']) - sessions[0][1]) / sessions[0][1] * 100, 4)))
