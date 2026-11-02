/* THE HIGHLIGHTED NAME'S READ, IN TWO BEATS (ported from the partner tree's ui/useNameRead.ts, 2026-11-02).

   The name search reads the row the pointer or the arrows rest on. Two clocks, so a sweep costs nothing and a rest
   costs one ask:
   · THE SETTLE (at once for the row the sheet opens on, 140 ms at rest after that): the column names the row and paints
     what this browser already holds — the last print in the quote store, the walls of a book already open. Nothing is
     asked of any feed.
   · THE ASK (450 ms at rest on the same name): the name's card (data/nameCard.ts — one request to our server, kept five
     minutes) seeds the four slow tables (report, wire, insiders, Congress) under the browser's own paths, and only then
     are the column's live hooks handed the name, so they mount on rows already in hand. Move on before the beat and
     nothing was asked; the last card in flight is aborted by the next. */

import { useEffect, useState } from 'react';
import { askCard, useNameCard, type CardState } from '../../data/nameCard';

export const SETTLE_MS = 140;
export const ASK_MS = 450;

export interface NameRead {
  /** The name the pointer rested on — the right column reads it */
  settled: string | null;
  /** The longer rest has come on the settled name: its card is asked, its live hooks may read */
  asked: boolean;
  /** The card's state for the settled name, once asked */
  card: CardState | null;
}

export function useNameRead(open: boolean, hiSym: string | null): NameRead {
  const [settled, setSettled] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSettled(null);
      return;
    }
    const id = window.setTimeout(() => setSettled(hiSym), settled == null ? 0 : SETTLE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hiSym]);

  useEffect(() => {
    if (!open || !hiSym) {
      setAsked(null);
      return;
    }
    const id = window.setTimeout(() => {
      setAsked(hiSym);
      askCard(hiSym);
    }, ASK_MS);
    return () => window.clearTimeout(id);
  }, [open, hiSym]);

  const isAsked = settled != null && asked === settled;
  const card = useNameCard(isAsked ? settled : null);
  return { settled, asked: isAsked, card };
}
