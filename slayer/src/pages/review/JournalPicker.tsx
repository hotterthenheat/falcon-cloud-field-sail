/* The journal's shared controls: WHICH JOURNAL (the book — paper, backtest, your own — and inside it one account,
   session or journal of your own, or all of them), the period, the file and the day's notes. Every journal page wears
   the same line, so moving between them never moves the controls. */

import { useEffect, useMemo, type ReactNode } from 'react';
import { Download, PenLine, Plus } from 'lucide-react';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import FilterTabs from '../../components/ui/FilterTabs';
import { usdSigned } from '../../components/review/words';
import { PERIODS, type Period } from '../../data/review/journalFigures';
import { goneOf, noteSeen, useSeen, type JournalBook, type JournalPick } from '../../data/review/journalBooks';
import { useJournalSource } from '../../data/review/journalSource';
import { manualDaysOf, useManualJournals } from '../../data/review/journalManual';
import { usePaper } from '../../data/paper/store';
import type { PaperAccount } from '../../data/paper/engine';

const BOOKS: readonly { value: JournalBook; label: string }[] = [
  { value: 'paper', label: 'Paper Trade' },
  { value: 'backtest', label: 'Backtest' },
  { value: 'manual', label: 'Your own' },
];
/** A small door on the controls line: the house's outline button, 40px to a finger */
export const door = 'tap-40 inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:hover:text-textSecondary disabled:hover:border-borderSubtle';

const money = (v: number) => usdSigned(v, 0);
/** "Practice · $25K" · "Evaluation · 50K plan" — what kind of account, in a few words */
const accountWords = (a: PaperAccount): string => {
  const size = a.startCash >= 1000 ? `$${Math.round(a.startCash / 1000)}K` : `$${a.startCash}`;
  const kind = a.kind === 'evaluation' ? `Evaluation${a.plan?.label ? ` · ${a.plan.label}` : ''}` : `Practice · ${size}`;
  const status = a.status === 'open' ? '' : ` · ${String(a.status)}`;
  return `${kind}${status}`;
};

/** WHICH JOURNAL: the book's tabs, and the journal inside it */
export const JournalPicker = ({ pick, onPick, onNew }: { pick: JournalPick; onPick: (p: JournalPick) => void; onNew: () => void }) => {
  const paper = useJournalSource('paper');
  const backtest = useJournalSource('backtest');
  const { accounts } = usePaper();
  const manual = useManualJournals();
  const seen = useSeen();

  /* every container's count and total — the dropdown's hints, and the register a deleted one is remembered by */
  const tally = (rows: { s: { id: string }; t: { pnl: number } }[]) => {
    const m = new Map<string, { n: number; net: number }>();
    for (const r of rows) {
      const x = m.get(r.s.id) ?? { n: 0, net: 0 };
      m.set(r.s.id, { n: x.n + 1, net: x.net + r.t.pnl });
    }
    return m;
  };
  const paperTally = useMemo(() => tally(paper.rows), [paper.rows]);
  const backtestTally = useMemo(() => tally(backtest.rows), [backtest.rows]);
  useEffect(() => {
    noteSeen('paper', paper.containers.map(c => ({ id: c.id, name: c.name, ...(paperTally.get(c.id) ?? { n: 0, net: 0 }) })));
  }, [paper.containers, paperTally]);
  useEffect(() => {
    noteSeen('backtest', backtest.containers.map(c => ({ id: c.id, name: c.name, ...(backtestTally.get(c.id) ?? { n: 0, net: 0 }) })));
  }, [backtest.containers, backtestTally]);

  const options = useMemo<DropdownOption<string>[]>(() => {
    if (pick.book === 'manual') {
      const out: DropdownOption<string>[] = [];
      if (manual.length > 1) {
        const all = [...manualDaysOf(manual).values()];
        out.push({ value: 'all', label: 'All your journals', hint: `${manual.length} journals · ${all.length} days · ${money(all.reduce((x, d) => x + d.net, 0))}` });
      }
      for (const j of manual) {
        const days = [...manualDaysOf([j]).values()];
        out.push({ value: j.id, label: j.name, hint: `${j.broker ? `${j.broker} · ` : ''}${days.length} ${days.length === 1 ? 'day' : 'days'}${days.length ? ` · ${money(days.reduce((x, d) => x + d.net, 0))}` : ''}`, group: manual.length > 1 ? 'One journal' : undefined });
      }
      out.push({ value: 'new', label: '+ New journal of your own', hint: 'Your real trades, from your own broker — entered by you', group: 'Add' });
      return out;
    }
    const src = pick.book === 'paper' ? paper : backtest;
    const t = pick.book === 'paper' ? paperTally : backtestTally;
    const word = pick.book === 'paper' ? 'account' : 'session';
    const allNet = [...t.values()].reduce((x, v) => x + v.net, 0);
    const out: DropdownOption<string>[] = [
      { value: 'all', label: pick.book === 'paper' ? 'All paper accounts' : 'All backtest sessions', hint: `${src.containers.length} ${word}${src.containers.length === 1 ? '' : 's'} · ${src.rows.length} closed${src.rows.length ? ` · ${money(allNet)}` : ''}` },
    ];
    for (const c of src.containers) {
      const x = t.get(c.id);
      const a = pick.book === 'paper' ? accounts.find(y => y.id === c.id) : undefined;
      out.push({ value: c.id, label: c.name, hint: `${a ? `${accountWords(a)} · ` : ''}${x ? `${x.n} closed · ${money(x.net)}` : 'nothing closed yet'}`, group: pick.book === 'paper' ? 'One account' : 'One session' });
    }
    for (const g of goneOf(seen, pick.book, src.containers)) out.push({ value: g.id, label: g.name, hint: `deleted · ${g.n} closed when last seen`, group: 'Deleted since', quiet: true });
    return out;
  }, [pick.book, paper, backtest, paperTally, backtestTally, accounts, manual, seen]);
  const value = pick.id ?? (pick.book === 'manual' && manual.length === 1 ? manual[0].id : 'all');

  return (
    <>
      <span className="min-w-0 max-sm:col-span-2 max-sm:order-first max-sm:overflow-x-auto" data-journal-books>
        <FilterTabs options={BOOKS} value={pick.book} onChange={b => onPick({ book: b, id: b === 'manual' && manual.length === 1 ? manual[0].id : null })} ariaLabel="Which book" />
      </span>
      {pick.book === 'manual' && !manual.length ? (
        <button type="button" onClick={onNew} className={door} data-journal-new>
          <Plus className="w-3 h-3" /> New journal
        </button>
      ) : (
        <DropdownSelect
          label="Journal"
          value={value}
          options={options}
          onChange={v => (v === 'new' ? onNew() : onPick({ book: pick.book, id: v === 'all' ? null : v }))}
          title={pick.book === 'paper' ? 'Which paper account' : pick.book === 'backtest' ? 'Which backtest session' : 'Which journal of your own'}
          testId="journal-pick"
        />
      )}
    </>
  );
};

/** THE PERIOD: the five tabs at a desk; on a phone, where five do not fit a row, one dropdown */
export const PeriodPick = ({ value, onChange }: { value: Period; onChange: (p: Period) => void }) => (
  <>
    <span className="min-w-0 max-sm:hidden" data-journal-periods>
      <FilterTabs options={PERIODS} value={value} onChange={onChange} ariaLabel="Which period" />
    </span>
    <span className="sm:hidden min-w-0 [&_button]:w-full [&_button]:justify-between" data-journal-periods-phone>
      <DropdownSelect label="Period" value={value} options={PERIODS.map(p => ({ value: p.value, label: p.label }))} onChange={onChange} testId="journal-period" />
    </span>
  </>
);

/** THE DOORS at the line's end: the day's notes (today's plan, or the day that is open) and the file — the file says
    why it cannot be had when it cannot */
export const EndDoors = ({ onNotes, notesWord = 'Today’s notes', onCsv, csvWhyNot, csvTitle, extra }: { onNotes?: () => void; notesWord?: string; onCsv: () => void; csvWhyNot: string | null; csvTitle: string; extra?: ReactNode }) => (
  <span className="ml-auto flex items-center gap-2 max-sm:col-span-2 max-sm:[&>*]:flex-1" data-journal-doors>
    {extra}
    {onNotes && (
      <button type="button" onClick={onNotes} className={door} title="The plan before the day and the review after it — kept as you type" data-journal-notes-door>
        <PenLine className="w-3 h-3" /> {notesWord}
      </button>
    )}
    <button type="button" onClick={onCsv} disabled={!!csvWhyNot} aria-disabled={!!csvWhyNot} title={csvWhyNot ?? csvTitle} className={`${door} disabled:opacity-60`} data-journal-export={csvWhyNot ? 'off' : 'on'}>
      <Download className="w-3 h-3" /> CSV{csvWhyNot && <span className="normal-case tracking-normal text-textMuted"> · {csvWhyNot.split(' — ')[0]}</span>}
    </button>
  </span>
);

/** A file handed to the reader */
export function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
