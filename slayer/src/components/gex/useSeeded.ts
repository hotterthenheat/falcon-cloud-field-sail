/*
  A name's book, asked for in the background. Ready when the live book
  has landed or the ask has failed. Still arriving while it loads, and
  it gives up after eight seconds so a name nobody fetched does not
  say "working" forever.
*/

import { useEffect, useState } from 'react';
import { ensureBook, peekEntry, useBookRev } from '../../data/uwBook';

const settled = (ticker: string) => {
  const e = peekEntry(ticker);
  return e?.status === 'live' || e?.status === 'error';
};

/** PASSIVE: is this name's book still on its way? It asks for the book, then watches. */
export function useNameArriving(ticker: string | null | undefined): boolean {
  const rev = useBookRev();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    setGaveUp(false);
    if (!ticker) return;
    ensureBook(ticker, 'board');
    const started = performance.now();
    const id = window.setInterval(() => {
      if (settled(ticker) || performance.now() - started > 8000) {
        setGaveUp(true);
        window.clearInterval(id);
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [ticker]);
  void rev;
  if (!ticker || gaveUp || settled(ticker)) return false;
  return true;
}

export function useSeeded(ticker: string | null | undefined): boolean {
  const rev = useBookRev();
  useEffect(() => {
    if (ticker) ensureBook(ticker, 'board');
  }, [ticker]);
  void rev;
  if (!ticker) return false;
  return settled(ticker);
}
