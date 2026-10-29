/*
==================================================
  SLAYER TERMINAL - THE POSITION CARD ON THE DESK
  (components/weigher/PositionDeskCard.tsx)

  The Weigher's bottom-right card (2026-09-14): the
  row picked in the list — a contract you WATCH
  (marked when added) or a position you OWN or
  SOLD (what you paid) — as Robinhood's Simulated
  Returns, in the Positions panel's clothes:

    THE FIGURES   the return at the chosen price
                  now, the estimated contract price,
                  "Now · 4 DTE"
    BY DATE       the return over the sessions to
                  the expiry at that price — the
                  line sinks as time runs out; a
                  dashed max-loss floor; the library
                  chart with its crosshair and card
    THE RULER     the stock's price under a marker,
                  dragged by the cent — the dealer
                  map's walls and flip on it
    BY PRICE      the payoff sketch — the other cut
                  of the same surface, the kept
                  price on it
    THE FACTS     what it has done since it was
                  added, then the map's five
    THE SENTENCE  where it sits, what the hedging
                  does to it

  One pricer for every figure: the chain's own
  estimator (data/positionCurve valueOn). A settled
  row shows the Robinhood notice as one quiet line.

  OUR READ · SIMULATED RETURNS (Noah, 2026-10-13:
  "if i click down on a strike chain then click on
  one of them in my position or watchlist the
  bottom right card should be able to switch
  between 'Our read' and 'simulated returns' i dont
  like how it says 'the positions' right now"): the
  card's head is the switch. A strike pressed on
  the chain opens on Our read (the case); a row
  pressed on a list opens on Simulated returns; the
  reader turns the card either way. The read speaks
  of the chain's contract — for a row the chain
  does not list (another date), it says so.
==================================================
*/

import { useMemo } from 'react';
import { Eye, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { When } from '../record/when';
import PositionForm from '../gex/PositionForm';
import { fmtPnl } from '../../data/positionCurve';
import { readPosition, type Position, type Right } from '../../data/positions';
import { setWatchedSize } from '../../data/watchlist';
import { isoDate } from '../../core/calendar';
import type { DeskContract } from '../../data/weigherDesk';
import type { ExposureProfileData } from '../../types/gex';
import { daysSince, dirInk, fmtStrike, monthDay, rSigned, usdSigned, type ListRow } from './PositionsList';

const DOOR_CLS =
  'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-borderSubtle bg-ink/[0.03] hover:bg-ink/[0.06] font-mono text-t9 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors';
/** The card's two faces */
export type CardView = 'read' | 'returns';
export const CARD_VIEWS = [
  { value: 'read', label: 'Our read' },
  { value: 'returns', label: 'The position' },
] as const;

/** One of the five facts under the sketch — the Position card's own grammar */
const Fact5 = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
  <div className="min-w-0">
    <dt className="text-t10 text-textMuted truncate">{k}</dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum leading-snug ${tone ?? 'text-textPrimary'}`}>{v}</dd>
  </div>
);

interface Props {
  /** The chain's picked contract — the empty states speak of it */
  picked: DeskContract | null;
  /** The row the card draws */
  row: ListRow | null;
  /** The day's dealer map for the name — the ruler's marks, the read's ground */
  profile: ExposureProfileData | null;
  contractKey: string;
  /** Watch the picked contract (not watched yet) */
  onWatch?: () => void;
  /** THE CASE for the picked contract (Noah's partner, 2026-10-10: the chain's dropdown was too small a window for
      it — "the position card to act as either the information of the chain … then if you decide to add a position or
      watchlist it acts as the simulated returns"): drawn in the card while the contract is not on the list; the returns
      take the card the moment it is */
  theCase?: React.ReactNode;
  /** Which face the card shows — the head's switch (WeigherDesk) */
  face: CardView;
  /** Whether the case in hand speaks of the row's own contract (the chain lists it) — else the read says so */
  caseForRow: boolean;
  ticker?: string;
  expiryIso?: string;
  chainSpot?: number;
  /** A watched row's doors */
  onClose?: () => void;
  onRemove?: () => void;
  /** An owned row's door — Change is the form itself */
  onRemovePosition?: () => void;
  quoteFor?: (strike: number, right: Right, expiry: string) => { listed: boolean; low: number | null; high: number | null } | null;
}

const PositionDeskCard = ({ picked, row, profile, contractKey, onWatch, onClose, onRemove, onRemovePosition, theCase, face, caseForRow, ticker = '', expiryIso = '', chainSpot = 0, quoteFor }: Props) => {

  /* THE POSITION the card prices: a watched contract is a long position marked when it was added */
  const pos: Position | null = useMemo(() => {
    if (!row) return null;
    if (row.kind === 'own') return row.p;
    const w = row.w;
    return { id: w.id, ticker: w.ticker, strike: w.strike, right: w.right, side: 'long', contracts: w.size, expiry: w.expiry, entry: w.addedMark, source: 'you', addedAt: w.addedAt };
  }, [row]);
  const spot = chainSpot > 0 ? chainSpot : profile?.levels.spot ?? null;
  const read = pos && profile ? readPosition(pos, profile) : null;
  const open = row ? (row.kind === 'watch' ? row.w.status === 'open' : (read?.sessions ?? 0) >= 0) : false;
  const sign = pos ? (pos.side === 'long' ? 1 : -1) * 100 * pos.contracts : 0;
  const paid = row?.kind === 'watch' ? row.w.addedMark : pos?.entry ?? null;
  const live = row == null ? null : row.kind === 'own' ? row.value : Number.isFinite(row.r.mark) ? row.r.mark : null;
  const retNow = live != null && paid != null && paid > 0 ? (live - paid) * sign : null;
  const intrinsic = spot != null && pos ? Math.max(0, pos.right === 'C' ? spot - pos.strike : pos.strike - spot) : null;
  const atExpiry = intrinsic != null && paid != null ? (intrinsic - paid) * sign : null;

  /* THE FOOT, pinned under either face: where the contract stands with the reader, then the doors */
  const w = row?.kind === 'watch' ? row.w : null;
  const foot =
    row && pos ? (
      <div key={`ft-${row.id}`} className="shrink-0 px-3.5 py-2 border-t border-borderSubtle/60 flex items-center gap-2 flex-wrap animate-soft-in" data-contract-foot>
        <span className="font-mono text-t10 text-textPrimary">
          {row.kind === 'watch' ? 'On your watchlist' : pos.side === 'long' ? 'A position you own' : 'A position you sold'}{' '}
          <span className="text-textMuted">
            · since {monthDay(isoDate(new Date(pos.addedAt)))}
            {row.kind === 'watch' && !open ? (row.w.status === 'closed' ? ' · closed' : ' · settled at the bell') : row.kind === 'own' && !open ? ` · expired ${monthDay(pos.expiry)}` : ''}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {row.kind === 'watch' ? (
            <>
              <span className={`${DOOR_CLS} text-textPrimary border-borderMuted`} title="On your watchlist" data-watch-door="watching">
                <Eye className="w-3 h-3" />
                Watching
              </span>
              {open && onClose && (
                <button onClick={onClose} className={DOOR_CLS} title="Close it at the mark now — the return locks" data-watch-close>
                  <X className="w-3 h-3" />
                  Close
                </button>
              )}
              {!open && onRemove && (
                <button onClick={onRemove} className={`${DOOR_CLS} text-bear/80 hover:text-bear`} title="Take it off the record" data-watch-remove>
                  <Trash2 className="w-3 h-3" />
                  Remove
                </button>
              )}
            </>
          ) : (
            <>
              <PositionForm
                ticker={pos.ticker}
                position={pos}
                defaultStrike={pos.strike}
                align="end"
                quoteFor={quoteFor}
                trigger={
                  <button className={DOOR_CLS} title="Change this position" data-position-change>
                    <Pencil className="w-3 h-3" />
                    Change
                  </button>
                }
              />
              {onRemovePosition && (
                <button onClick={onRemovePosition} className={`${DOOR_CLS} text-bear/80 hover:text-bear`} title="Remove this position" data-position-remove>
                  <Trash2 className="w-3 h-3" />
                  Remove
                </button>
              )}
            </>
          )}
        </span>
      </div>
    ) : (
      <div className="shrink-0 px-3.5 py-2 border-t border-borderSubtle/60 flex items-center gap-2 flex-wrap" data-contract-foot>
        <span className="font-mono text-t10 text-textMuted">Not on your list — Watch it marks it at this tick's price</span>
        <span className="ml-auto flex items-center gap-1.5">
          {onWatch && (
            <button onClick={onWatch} className={DOOR_CLS} title="Watch it — marked at this tick's price, tracked as if bought" data-watch-door="watch">
              <Eye className="w-3 h-3" />
              Watch it
            </button>
          )}
        </span>
      </div>
    );

  /* ---- the empty states -------------------------------------------------------------- */
  if (!picked && !row) {
    return (
      <div className="h-full min-h-[404px] flex flex-col items-center justify-center gap-1.5 select-none animate-soft-in">
        <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textMuted">Nothing picked yet</span>
        <span className="font-mono text-t9 text-textMuted">Press + on a strike in the chain to watch it, add a position, or click a row of the list — its returns land here</span>
      </div>
    );
  }
  /* ---- OUR READ: the case for the contract in hand, over the row's own foot ------------- */
  if (face === 'read') {
    const c = row ? (row.kind === 'watch' ? row.w : row.p) : null;
    return (
      <div className="h-full flex flex-col animate-soft-in" data-card-face="read">
        {/* 363 + the 41px foot = the same 404 */}
        {theCase && (caseForRow || !row) ? (
          /* THE CASE, in the card's own measure: the body scrolls when the case is taller than the row */
          <div key={contractKey} className="h-full min-h-0 overflow-hidden px-4 pt-3 pb-3 flex flex-col" data-contract-case>
            {theCase}
          </div>
        ) : (
          <div key={contractKey} className="flex-1 min-h-[363px] flex flex-col items-center justify-center gap-1.5 px-6 text-center select-none animate-soft-in" data-contract-noread>
            <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textMuted">No read for this date</span>
            <span className="font-mono text-t9 text-textMuted">
              {c ? `The read is made for a contract the chain lists — this one expires ${monthDay(c.expiry)}, a date the chain no longer carries` : 'Press a strike on the chain for its read'}
            </span>
          </div>
        )}
        {foot}
      </div>
    );
  }

  /* ---- SIMULATED RETURNS ---------------------------------------------------------------- */
  if (!row || !pos) {
    return (
      <div className="h-full flex flex-col animate-soft-in" data-card-face="returns">
        <div key={contractKey} className="flex-1 min-h-[363px] flex flex-col items-center justify-center gap-1.5 px-6 text-center select-none animate-soft-in" data-contract-unwatched>
          <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textMuted">Not on your list</span>
          <span className="font-mono text-t9 text-textMuted">Press a row. The return is the live mark against what you paid.</span>
        </div>
        {foot}
      </div>
    );
  }

  /* ---- the card ---------------------------------------------------------------------- */
  const per = 100 * pos.contracts;
  const title = `${pos.contracts} × ${pos.ticker} ${fmtStrike(pos.strike)} ${pos.right === 'C' ? 'call' : 'put'}${pos.contracts === 1 ? '' : 's'}`;
  const line =
    row.kind === 'watch'
      ? `You are watching it. Marked $${row.w.addedMark.toFixed(2)} when you pressed +. Not a trade.`
      : `${pos.side === 'long' ? 'You own it' : 'You sold it'} · ${paid != null ? `paid ${paid.toFixed(2)}` : 'no price given'} · ${pos.source === 'tracker' ? 'from the Tracker' : 'added by you'}`;

  return (
    <div className="h-full flex flex-col animate-soft-in" data-card-face="returns">
      <div key={`pc-${row.id}`} className="flex-1 min-h-0 flex flex-col gap-3 px-4 pt-3 pb-3 animate-soft-in-slow" data-watch-position={row.kind === 'watch' ? row.w.status : pos.side}>
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-t14 font-semibold leading-tight text-textPrimary truncate">{title}</h4>
            <p className="mt-0.5 text-t11 text-textMuted truncate">{line}</p>
          </div>
        </header>

        {open ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3" data-position-math>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">{row.kind === 'watch' ? 'Marked' : 'Paid'}</dt>
              <dd className="mt-1 font-mono text-t16 font-semibold tnum text-textPrimary">{paid != null ? `$${paid.toFixed(2)}` : '—'}</dd>
            </div>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">Live</dt>
              <dd className="mt-1 font-mono text-t16 font-semibold tnum text-textPrimary" data-sim-est>{live != null ? `$${live.toFixed(2)}` : '—'}</dd>
            </div>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">Today</dt>
              <dd className={`mt-1 font-mono text-t16 font-semibold tnum ${row.kind === 'watch' ? (Number.isFinite(row.r.todayDollars) ? dirInk(row.r.todayDollars) : 'text-textMuted') : row.today != null ? dirInk(row.today) : 'text-textMuted'}`}>
                {row.kind === 'watch' ? (Number.isFinite(row.r.todayDollars) ? fmtPnl(row.r.todayDollars) : '—') : row.today != null ? fmtPnl(row.today) : '—'}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">Total</dt>
              <dd className={`mt-1 font-mono text-t16 font-semibold tnum ${retNow == null ? 'text-textMuted' : dirInk(retNow)}`} data-sim-return>{retNow == null ? '—' : fmtPnl(retNow)}</dd>
            </div>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">If it expired here</dt>
              <dd className={`mt-1 font-mono text-t16 font-semibold tnum ${atExpiry == null ? 'text-textMuted' : dirInk(atExpiry)}`}>{atExpiry == null ? '—' : fmtPnl(atExpiry)}</dd>
            </div>
            <div>
              <dt className="font-mono text-t9 uppercase tracking-widest text-textMuted">Breakeven</dt>
              <dd className="mt-1 font-mono text-t16 font-semibold tnum text-textPrimary">{paid != null ? `$${(pos.right === 'C' ? pos.strike + paid : pos.strike - paid).toFixed(2)}` : '—'}</dd>
            </div>
            <p className="col-span-2 text-t11 leading-snug text-textMuted">{row.kind === 'watch' ? 'Not a trade. The total is how far the live quote has moved since you marked it. If it expired here is the stock against the strike, minus that mark.' : 'The total is the live mark against what you paid. If it expired here is the stock price against the strike, minus what you paid.'}</p>
          </dl>
        ) : (
          /* Robinhood's "only available for active positions", as one quiet line */
          /* `flex-1`: the card fills its row (WeigherDesk, 2026-10-07), and the room a live chart would take is this box's */
          <div className="flex-1 min-h-[96px] flex items-center justify-center rounded-md border border-borderSubtle/60 bg-ink/[0.02]" data-sim-settled>
            <span className="font-mono text-t10 text-textMuted">
              {w ? (w.status === 'closed' ? 'Closed by hand' : 'Settled at the bell') : `Expired ${monthDay(pos.expiry)}`}
            </span>
          </div>
        )}

        {/* WHAT IT HAS DONE — since the moment it was added (watched), or against what you paid (owned) */}
        <dl className="grid grid-cols-5 gap-x-4 gap-y-1 border-t border-borderSubtle/50 pt-3" data-position-facts="watch">
          {row.kind === 'watch' ? (
            <>
              <Fact5 k="Market value" v={Number.isFinite(row.r.mark) ? `$${(row.r.mark * per).toFixed(2)}` : '—'} />
              <Fact5 k="Marked when added" v={`$${row.w.addedMark.toFixed(2)}`} />
              <Fact5 k="Today" v={open && Number.isFinite(row.r.todayDollars) ? `${usdSigned(row.r.todayDollars)} · ${rSigned(row.r.todayR)}` : '—'} tone={open && Number.isFinite(row.r.todayDollars) ? dirInk(row.r.todayDollars) : 'text-textMuted'} />
              <Fact5 k="Total return" v={Number.isFinite(row.r.totalDollars) ? `${usdSigned(row.r.totalDollars)} · ${rSigned(row.r.totalR)}` : '—'} tone={Number.isFinite(row.r.totalDollars) ? dirInk(row.r.totalDollars) : 'text-textMuted'} />
              <div className="min-w-0">
                <dt className="text-t10 text-textMuted truncate">Contracts</dt>
                <dd className="mt-0.5 inline-flex items-center gap-1 font-mono text-t12 tnum leading-snug text-textPrimary">
                  <button type="button" onClick={() => setWatchedSize(row.w.id, row.w.size - 1)} disabled={row.w.size <= 1 || !open} className="inline-flex items-center justify-center w-4 h-4 rounded border border-borderSubtle text-textMuted hover:text-textPrimary disabled:opacity-30 transition-colors" aria-label="One contract fewer" data-watch-size="less">
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span data-watch-size-value>{row.w.size}</span>
                  <button type="button" onClick={() => setWatchedSize(row.w.id, row.w.size + 1)} disabled={!open} className="inline-flex items-center justify-center w-4 h-4 rounded border border-borderSubtle text-textMuted hover:text-textPrimary disabled:opacity-30 transition-colors" aria-label="One contract more" data-watch-size="more">
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                  <span className="ml-1 text-t10 text-textMuted">
                    · added <When days={daysSince(row.w.addedAt)} size={10} />
                  </span>
                </dd>
              </div>
            </>
          ) : (
            <>
              <Fact5 k="Market value" v={row.value == null ? '—' : `$${(row.value * per).toFixed(2)}`} />
              <Fact5 k={pos.side === 'long' ? 'What you paid' : 'What you collected'} v={paid != null ? `$${paid.toFixed(2)}` : 'no price given'} tone={paid != null ? undefined : 'text-textMuted'} />
              <Fact5 k="Total return" v={row.total != null && row.totalR != null ? `${usdSigned(row.total)} · ${rSigned(row.totalR)}` : '—'} tone={row.total != null ? dirInk(row.total) : 'text-textMuted'} />
              <Fact5 k="Contracts" v={`${pos.contracts} · ${pos.side === 'long' ? 'you own' : 'you sold'}`} />
              <Fact5 k="Added" v={<When days={daysSince(pos.addedAt)} size={11} />} />
            </>
          )}
        </dl>
      </div>

      {foot}
    </div>
  );
};

export default PositionDeskCard;
