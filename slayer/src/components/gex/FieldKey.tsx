/* The exposure nodes' key: one compact chip in the chart's top-right corner, under the expand door and in the price
   scale's top margin, so it never sits on a bar. It holds the model switch (dealer flow / open interest), the colour
   scale with the dollars a full-light node stands for, and the cut's net GEX; the rest — what the model is, when the
   day's record starts, yesterday — is the chip's hover. */
import { memo } from 'react';
import { BEAD_RAMP_CSS, FIELD_RAMP_CSS } from './gexNodesPrimitive';
import { THREAD_RAMP_CSS } from './nodeThreads';
import { nodeConcept } from './nodeConcept';
import { fmtUsd } from '../../data/gex';
import { FIELD_MODE_WORDS, setFieldMode, useFieldMode } from '../../data/fieldMode';
import { useDeskPrefs } from '../../data/deskPrefs';
import { exposureTodayFrom, ledgerFlowNet, priorSessionWords, useExposureLogRev, useFieldPoll, useServerExposure, type FieldMode, type ServerExposure } from '../../data/book/exposureLog';
import { useBookRev } from '../../data/book/store';
import { nyClock, nyIsoDate, nyWallTime } from '../../core/nyTime';

/** Where the field's day starts, in words: the server's record from the open, a recorder that started late, or (no
    recorder on this server) this page's own first read */
function sinceWords(first: number | null, server: ServerExposure, now = Date.now()): string {
  if (first == null) return 'waiting for the first reading';
  const since = nyClock(first);
  if (server.state === 'off') return `read since ${since} ET (this page's first read; no recorder runs on this server)`;
  if (server.state === 'on') {
    const [y, m, d] = nyIsoDate(now).split('-').map(Number);
    const open = nyWallTime(y, m, d, 9, 30);
    if (first > open + 120_000 && now > open && nyIsoDate(first) === nyIsoDate(now)) return `recorded from ${since} ET; nothing before it was read`;
  }
  return `read since ${since} ET`;
}

const MODES: readonly { value: FieldMode; label: string }[] = [
  { value: 'flow', label: 'Flow' },
  { value: 'oi', label: 'OI' },
];

interface FieldKeyProps {
  ticker: string;
  /** The cut's expiry (YYYY-MM-DD) or 'book' */
  cut: string | null;
  /** The cut in a reader's words: "Oct 29", "Every expiry" */
  cutWords: string;
  /** The size a full-light node stands for, dollars per 1% (the field's scale) */
  scale: number;
  /** The cut's net GEX off the house's rows for it (dealer sign) — the figure Pinpoint prints for the same cut */
  oiNet: number | null;
  /** A narrow pane: the net figure alone, no scale numbers */
  compact?: boolean;
}

function FieldKey({ ticker, cut, cutWords, scale, oiNet, compact = false }: FieldKeyProps) {
  const mode = useFieldMode();
  const { nodeLook } = useDeskPrefs();
  useExposureLogRev(ticker);
  useBookRev();
  useFieldPoll(ticker, cut);
  const server = useServerExposure(ticker);
  const since = sinceWords(exposureTodayFrom(ticker), server);
  const words = FIELD_MODE_WORDS[mode];
  const flowNet = mode === 'flow' && cut ? ledgerFlowNet(ticker, cut) : null;
  const netValue = mode === 'oi' ? oiNet : flowNet;
  const netWords = netValue == null ? '—' : `${netValue >= 0 ? '+' : ''}${fmtUsd(netValue)}`;
  const netInk = netValue == null ? '' : netValue >= 0 ? 'text-goldline' : 'text-steelline';
  const yesterday = cut ? priorSessionWords(ticker, cut) : null;
  /* the dev-only threads (nodeConcept.ts) wear the walls' two inks */
  const ramp = nodeConcept() === 'threads' ? THREAD_RAMP_CSS : nodeLook === 'heat' ? FIELD_RAMP_CSS : BEAD_RAMP_CSS;
  const title = [
    `${words.name}: ${words.line}.`,
    scale > 0 ? `Full light: ${fmtUsd(scale)} per 1% move — short gamma (pushes a move along) left, long gamma (holds it back) right.` : 'No reading in this session yet.',
    `Net GEX ${netWords} · ${mode === 'flow' ? "today's flow" : 'open interest'} · ${cutWords} · ${since}.`,
    yesterday ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div
      className="pointer-events-auto select-none inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-ink/[0.08] bg-canvas/80 px-1.5 py-0.5 font-mono text-t9 text-textMuted"
      /* no backdrop blur: the tape repaints under it on every pointer move, and a blur would be re-rendered each time */
      data-field-key
      data-chart-chrome
      title={title}
    >
      <span role="group" aria-label="Which model the exposure nodes show" className="inline-flex items-center rounded-[3px] border border-ink/[0.08] p-px">
        {MODES.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => setFieldMode(m.value)}
            aria-pressed={mode === m.value}
            title={FIELD_MODE_WORDS[m.value].name}
            className={`rounded-[2px] px-1 leading-[14px] transition-colors ${mode === m.value ? 'bg-ink/[0.14] text-textPrimary font-semibold' : 'text-textMuted hover:text-textPrimary'}`}
          >
            {m.label}
          </button>
        ))}
      </span>
      <span className="inline-flex items-center gap-1" aria-label="Colour scale">
        {!compact && <span className="tnum">{scale > 0 ? `−${fmtUsd(scale)}` : '—'}</span>}
        <span className="h-1.5 w-5 rounded-sm" style={{ background: ramp.neg, transform: 'scaleX(-1)' }} aria-hidden />
        <span className="h-1.5 w-5 rounded-sm" style={{ background: ramp.pos }} aria-hidden />
        {!compact && <span className="tnum">{scale > 0 ? `+${fmtUsd(scale)}` : ''}</span>}
      </span>
      <span className={`tnum font-semibold ${netInk}`} data-field-net>
        {netWords}
      </span>
    </div>
  );
}

export default memo(FieldKey);
