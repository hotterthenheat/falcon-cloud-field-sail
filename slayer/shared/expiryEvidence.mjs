/*
  Which expiration dates a root really has: the terminal's expiration list checked against its own contracts.

  The ticker audit of 2026-11-07 (commit 1e78a97, reports/expiry_mismatches.csv) found the terminal's
  /option/list/expirations wrong both ways:
  - 56 dates that do not exist (SPX 2088-07-10 … 2090-06-18, TT 2027-04-16, PWR 2027-08-20, RIO 2031-01-01 …): no
    contract was ever quoted, traded or listed on them;
  - 18 dates it had not picked up yet, first quoted on 2026-11-06 (SPX 2026-12-15, NDX 2026-12-14, RUT 2026-11-23,
    SPY 2027-04-16 …): the list lags a new listing by a session or more.
  So a live date (today or later, New York) is offered only when at least one contract sits behind it in what the
  terminal says about the contracts themselves: the current NBBO snapshot of every expiration
  (/option/snapshot/quote?expiration=*: every contract with a quote, or listed and waiting for its first), the current
  open-interest report (/option/snapshot/open_interest?expiration=*: every listed contract, zeros included), or a list
  of the contracts quoted or traded on a session (/option/list/contracts/{quote,trade}?date=D). A date the evidence
  carries and the list does not is added the day its contracts appear.

  A date before today is history, not a choice: it passes through as the list has it (Backtest and the review read
  old expirations). When no evidence could be read at all the list is passed on unverified, less the dates the last
  build of the ticker universe found empty and plus the ones it found new (`fallback`).

  Used by the terminal proxy for every /option/list/expirations answer (server/thetaProxy.mjs), so every page and
  server reader gets the checked list, and by scripts/build-ticker-universe.mjs.
*/

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** YYYYMMDD or YYYY-MM-DD(…) → YYYY-MM-DD, or '' */
export function isoOf(raw) {
  const s = String(raw ?? '').trim().replace(/^"|"$/g, '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = s.slice(0, 10);
  return ISO.test(d) ? d : '';
}

/** A JSON or CSV answer's text → its rows' expiration dates (YYYY-MM-DD), each once. Reads the terminal's three
    shapes: a CSV with an `expiration` column, `{ response: [{ expiration }] }`, and
    `{ response: [{ contract: { expiration } }] }`. */
export function expirationsIn(body) {
  const out = new Set();
  if (body == null) return out;
  const text = typeof body === 'string' ? body : String(body);
  const head = text.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return out;
    }
    const rows = Array.isArray(j) ? j : Array.isArray(j?.response) ? j.response : [];
    for (const r of rows) {
      const d = isoOf(r?.expiration ?? r?.contract?.expiration);
      if (d) out.add(d);
    }
    return out;
  }
  const lines = text.split(/\r?\n/);
  const cols = (lines[0] ?? '').split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const at = cols.indexOf('expiration');
  if (at < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const d = isoOf(line.split(',')[at]);
    if (d) out.add(d);
  }
  return out;
}

/**
 * The dates to offer for one root.
 * @param {object} o
 * @param {Iterable<string>} o.listed      the terminal's expiration list (YYYY-MM-DD)
 * @param {Array<Iterable<string> | null>} o.evidence  each evidence read's dates; null for a read that failed
 * @param {string} o.today                New York's date: dates before it pass through as listed
 * @param {{ drop?: Iterable<string>, add?: Iterable<string> }} [o.fallback]  the last build's verdict for this root,
 *   used only when no evidence could be read
 * @returns {{ dates: string[], phantom: string[], added: string[], verified: boolean }}
 */
export function verifyExpirations(o) {
  const today = o.today;
  const listed = [...new Set([...(o.listed ?? [])].map(isoOf).filter(Boolean))].sort();
  const reads = (o.evidence ?? []).filter((e) => e != null);
  const past = listed.filter((d) => d < today);
  const live = listed.filter((d) => d >= today);
  if (!reads.length) {
    const drop = new Set([...(o.fallback?.drop ?? [])].map(isoOf));
    const add = [...(o.fallback?.add ?? [])].map(isoOf).filter((d) => d && d >= today && !live.includes(d));
    const phantom = live.filter((d) => drop.has(d));
    const kept = live.filter((d) => !drop.has(d));
    return { dates: [...past, ...new Set([...kept, ...add])].sort(), phantom, added: [...new Set(add)].sort(), verified: false };
  }
  const seen = new Set();
  for (const r of reads) for (const d of r) if (isoOf(d) && isoOf(d) >= today) seen.add(isoOf(d));
  const phantom = live.filter((d) => !seen.has(d));
  const added = [...seen].filter((d) => !live.includes(d)).sort();
  return { dates: [...past, ...[...seen].sort()], phantom, added, verified: true };
}

/** The checked list in the shape the terminal answers: CSV (`symbol,expiration`) or JSON (`{ response: [...] }`) */
export function expirationsBody(root, dates, csv) {
  if (csv) return `symbol,expiration\n${dates.map((d) => `"${root}","${d}"`).join('\n')}${dates.length ? '\n' : ''}`;
  return JSON.stringify({ response: dates.map((d) => ({ symbol: root, expiration: d })) });
}
