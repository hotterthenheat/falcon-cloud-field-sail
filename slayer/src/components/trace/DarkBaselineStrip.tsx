/* A name's dark day against its own last 20 sessions (data/darkBaseline.ts): today's dark share of volume and its
   whole-session posture, each as a z-score and a percentile. Read only when asked — about sixty calls, one at a time
   — with the progress shown, and kept for the rest of the visit. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DARK_BASELINE_SESSIONS, loadDarkBaseline, sessionsBack, type BaselineStat, type DarkBaseline } from '../../data/darkBaseline';
import { POSTURE_WORD } from '../../data/darkpool';
import { shortDay } from './dayWords';
import { uwCall } from '../../data/whales';

/* one read per name and day for the visit: a finished one is kept, a running one is shared */
const kept = new Map<string, DarkBaseline>();
const running = new Map<string, { p: Promise<DarkBaseline>; progress: Progress; listeners: Set<(p: Progress) => void> }>();

interface Progress {
  /** Sessions read so far (today and its trailing sessions), of `of` */
  session: number;
  of: number;
  calls: number;
}

const keyOf = (ticker: string, iso: string) => `${ticker.toUpperCase()}:${iso}`;

function startRead(ticker: string, iso: string) {
  const k = keyOf(ticker, iso);
  const had = running.get(k);
  if (had) return had;
  const isos = sessionsBack(iso, DARK_BASELINE_SESSIONS);
  const progress: Progress = { session: 0, of: isos.length, calls: 0 };
  const listeners = new Set<(p: Progress) => void>();
  const get = async (path: string) => {
    const m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(path);
    const at = m ? isos.indexOf(m[1]) : -1;
    if (at >= 0) progress.session = Math.max(progress.session, at + 1);
    progress.calls += 1;
    for (const f of listeners) f({ ...progress });
    const r = await uwCall(path, false, true);
    if (r.error) throw new Error(String(r.error));
    return r.data;
  };
  const entry = { p: loadDarkBaseline(get, ticker, iso), progress, listeners };
  running.set(k, entry);
  entry.p.then(
    b => {
      kept.set(k, b);
      running.delete(k);
    },
    () => running.delete(k)
  );
  return entry;
}

const ordinal = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : r % 10 === 1 ? 'st' : r % 10 === 2 ? 'nd' : r % 10 === 3 ? 'rd' : 'th';
  return `${r}${s}`;
};
/** "85th percentile"; the ends said plainly — "below all 20" / "above all 20" */
const pctWords = (p: number | null, n: number) => (p == null ? 'percentile —' : p <= 0 ? `below all ${n}` : p >= 100 ? `above all ${n}` : `${ordinal(p)} percentile`);
const signed =(v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const zWords = (z: number | null) => (z == null ? 'z —' : `z ${signed(z, 2)}`);
const STATUS_TIP = `Set against the name's previous ${DARK_BASELINE_SESSIONS} sessions. Full with all ${DARK_BASELINE_SESSIONS}; partial with 5 to ${DARK_BASELINE_SESSIONS - 1}; under 5, no comparison is made.`;
const Z_TIP = 'How many standard deviations today sits from the sessions’ mean (sample deviation); — when the sessions never moved';
const PCT_TIP = 'The share of the sessions below today (ties count half)';

/** Where today sits among the sessions: a dot per session, today ringed */
const DotStrip = ({ values, today, fmt }: { values: number[]; today: number; fmt: (v: number) => string }) => {
  const all = [...values, today].filter(Number.isFinite);
  if (all.length < 2) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const at = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  return (
    <span className="relative block h-3 mx-1.5 w-[calc(100%-12px)] max-w-[220px]" title={`Each dot a session, ${fmt(lo)} to ${fmt(hi)}; the ring is today`} aria-hidden>
      <span className="absolute left-0 right-0 top-1/2 h-px bg-ink/[0.12]" />
      {values.filter(Number.isFinite).map((v, i) => (
        <span key={i} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-textMuted/70" style={{ left: `${at(v)}%` }} />
      ))}
      <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-textPrimary bg-panel" style={{ left: `${at(today)}%` }} />
    </span>
  );
};

const StatusTag = ({ s, n }: { s: BaselineStat['status']; n: number }) => (
  <span className={`font-mono text-t11 ${s === 'PARTIAL' ? 'text-warn' : 'text-textMuted'}`} title={STATUS_TIP} data-baseline-status={s}>
    {s === 'PARTIAL' ? `partial · ${n} of ${DARK_BASELINE_SESSIONS} sessions` : s === 'OK' ? `${n} of ${DARK_BASELINE_SESSIONS} sessions` : `${n} of ${DARK_BASELINE_SESSIONS} sessions — too few to compare`}
  </span>
);

const Stat = ({ label, tip, stat, todayText, meanText, values, fmt, testId }: { label: string; tip: string; stat: BaselineStat; todayText: string; meanText: string; values: number[]; fmt: (v: number) => string; testId: string }) => (
  <div className="min-w-0 flex flex-col gap-1" data-baseline-stat={testId}>
    <div className="flex items-baseline gap-2 flex-wrap text-t11">
      <span className="text-textMuted" title={tip}>
        {label}
      </span>
      <StatusTag s={stat.status} n={stat.n} />
    </div>
    {stat.status === 'UNAVAILABLE' ? (
      <div className="font-mono text-t12 text-textMuted">No comparison: {Number.isFinite(stat.today) ? 'too few earlier sessions had a reading' : 'today has no reading'}.</div>
    ) : (
      <>
        <div className="font-mono text-t12 tnum text-textPrimary">
          <span className="font-bold">{todayText}</span>
          <span className="text-textSecondary"> vs a normal {meanText} · </span>
          <span title={Z_TIP}>{zWords(stat.z)}</span>
          <span className="text-textSecondary"> · </span>
          <span title={PCT_TIP}>{pctWords(stat.percentile, stat.n)}</span>
        </div>
        <DotStrip values={values} today={stat.today} fmt={fmt} />
      </>
    )}
  </div>
);

const DarkBaselineStrip = ({ ticker, todayIso, sessionLive }: { ticker: string; todayIso: string; sessionLive: boolean }) => {
  const k = keyOf(ticker, todayIso);
  /* held with the name and day it is for: on a switch the last name's baseline is not painted for a frame under the new
     one while the effect below catches up */
  const [held, setHeld] = useState<{ k: string; base: DarkBaseline | null }>(() => ({ k, base: kept.get(k) ?? null }));
  const base = held.k === k ? held.base : kept.get(k) ?? null;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(k);
  alive.current = k;

  const attach = useCallback((entry: ReturnType<typeof startRead>, key: string) => {
    setProgress({ ...entry.progress });
    const f = (p: Progress) => alive.current === key && setProgress(p);
    entry.listeners.add(f);
    entry.p.then(
      b => {
        entry.listeners.delete(f);
        if (alive.current !== key) return;
        setHeld({ k: key, base: b });
        setProgress(null);
      },
      () => {
        entry.listeners.delete(f);
        if (alive.current !== key) return;
        setFailed(true);
        setProgress(null);
      }
    );
  }, []);

  /* a new name or day: what is kept for it, or the read already running for it */
  useEffect(() => {
    setHeld({ k, base: kept.get(k) ?? null });
    setFailed(false);
    setProgress(null);
    const r = running.get(k);
    if (r) attach(r, k);
  }, [k, attach]);

  const ask = () => {
    setFailed(false);
    attach(startRead(ticker, todayIso), k);
  };

  const dayWord = sessionLive ? 'today so far' : shortDay(todayIso);
  return (
    <div className="px-5 py-3 border-t border-borderSubtle flex flex-col gap-2" data-dark-baseline data-state={base ? 'read' : progress ? 'reading' : failed ? 'failed' : 'idle'}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-t11 uppercase tracking-widest text-textPrimary">Against its normal</span>
        <span className="text-t11 text-textMuted">
          {ticker}'s {dayWord} against its previous {DARK_BASELINE_SESSIONS} sessions · whole-session figures, so this posture can differ from the one above, which reads only the crosses in hand
        </span>
      </div>
      {base ? (
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <Stat
            label="Dark share of the whole day's volume"
            tip="Off-exchange shares at prices the lit tape also traded, over the day's whole share volume, pre-market through 20:00 ET — the same share as the off-exchange figure above"
            stat={base.share}
            todayText={`${base.share.today.toFixed(1)}%`}
            meanText={`${base.share.mean.toFixed(1)}%`}
            values={base.history.map(s => s.sharePct)}
            fmt={v => `${v.toFixed(1)}%`}
            testId="share"
          />
          <Stat
            label="Whole-session posture"
            tip="Every sized regular-session dark print of the day at the quote, dollars over the mid less dollars under it, over their dollars — the same rule as the posture above, on the whole session, not the prints in hand"
            stat={base.posture}
            todayText={`${signed(base.posture.today)}%${base.posture.todayPosture ? ` ${POSTURE_WORD[base.posture.todayPosture].toLowerCase()}` : ''}`}
            meanText={`${signed(base.posture.mean)}%`}
            values={base.history.filter(s => s.postureEnough).map(s => s.postureNet)}
            fmt={v => `${signed(v)}%`}
            testId="posture"
          />
        </div>
      ) : progress ? (
        <div className="flex items-center gap-3 font-mono text-t11 text-textSecondary" role="status" data-baseline-progress>
          <span className="relative h-1 w-40 max-w-[40%] rounded-full bg-ink/[0.08] overflow-hidden">
            <span className="absolute left-0 top-0 h-full bg-silver/70 transition-[width] duration-300" style={{ width: `${Math.round((progress.session / progress.of) * 100)}%` }} />
          </span>
          <span className="tnum">
            Reading session {Math.max(1, progress.session)} of {progress.of} · {progress.calls} requests
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="slayer-chip" onClick={ask} data-baseline-ask>
            {failed ? 'Try again' : 'Compare to its 20-session normal'}
          </button>
          <span className="text-t11 text-textMuted">{failed ? 'The market-data feed did not answer for every session — nothing is shown rather than half a comparison.' : 'Reads the name’s last 21 sessions one at a time — about a minute.'}</span>
        </div>
      )}
    </div>
  );
};

export default DarkBaselineStrip;
