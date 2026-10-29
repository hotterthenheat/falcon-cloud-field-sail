/* The two journals' one seam: where the trades come from (paper accounts or backtest sessions), where their notes
   are kept, and what the page's foot says about the prices. */

import { useMemo } from 'react';
import { paperRowsOf, rowsOf, type DayNote, type JournalEntry, type JournalRow } from './journal';
import { setDayNote as setReviewDayNote, setEntry as setReviewEntry, useSessions } from './store';
import { setPaperDayNote, setPaperEntry, usePaper, usePaperJournal } from '../paper/store';
import { nyAt } from '../paper/clock';
import { calendarDayOf } from './journalFigures';

export type JournalKind = 'backtest' | 'paper';
interface JournalSource {
  kind: JournalKind;
  /** The journal's own address */
  base: string;
  /** Every closed trade it holds, newest first */
  rows: JournalRow[];
  /** What its trades are grouped under — a session, an account — for the cut's card */
  containers: { id: string; name: string }[];
  /** "session" · "account" */
  containerWord: string;
  /** Where one of them is opened */
  containerPath: (id: string) => string;
  setEntry: (containerId: string, tradeId: string, patch: Partial<JournalEntry>) => void;
  setDayNote: (containerId: string, day: string, patch: Partial<DayNote>) => void;
  /** A container's day notes, by trading day — a day with words and no trade has them too */
  notesOf: (containerId: string) => Record<string, DayNote>;
  /** The calendar day it is in New York — the paper journal's today; the backtest's newest closed day */
  today: string;
  /** The container in hand (the paper desk's account) — whose note a day with no trades on it takes */
  current: string | null;
  /** The line under a trade's page */
  foot: string;
}

/** A journal's source — both stores are read (a hook each, always), only the asked one's rows are made */
export function useJournalSource(kind: JournalKind): JournalSource {
  const sessions = useSessions();
  const paper = usePaper();
  const words = usePaperJournal();
  return useMemo<JournalSource>(() => {
    if (kind === 'paper') {
      const accounts = paper.accounts;
      return {
            kind,
            base: '/practice/journal',
            rows: paperRowsOf(accounts, words),
            containers: accounts.map(a => ({ id: a.id, name: a.name })),
            containerWord: 'account',
            /* each account's desk is its own address */
            containerPath: id => `/practice/paper/${id}`,
            setEntry: setPaperEntry,
            setDayNote: setPaperDayNote,
            notesOf: id => ({ ...accounts.find(a => a.id === id)?.days, ...words.days[id] }),
            today: nyAt(Date.now()).date,
            current: paper.inHand,
            foot: 'Paper trades fill at each contract’s live NBBO — practice, not advice. Every time on this page is New York’s (ET).',
      };
    }
    const rows = rowsOf(sessions);
    return {
              kind,
              base: '/practice/journal',
              rows,
              containers: sessions.map(s => ({ id: s.id, name: s.name })),
              containerWord: 'session',
              containerPath: id => `/practice/backtest/${id}`,
              setEntry: setReviewEntry,
              setDayNote: setReviewDayNote,
              notesOf: id => sessions.find(s => s.id === id)?.days ?? {},
              /* a replayed journal has no today of its own: its newest day stands in */
              today: rows[0] ? calendarDayOf(rows[0]) : new Date().toISOString().slice(0, 10),
              current: null,
              foot: 'Backtest trades fill at ThetaData’s recorded NBBO at the end of each minute — practice, not advice. Every time on this page is New York’s (ET).',
    };
  }, [kind, kind === 'paper' ? paper.accounts : sessions, words, paper.inHand]); // eslint-disable-line react-hooks/exhaustive-deps
}
