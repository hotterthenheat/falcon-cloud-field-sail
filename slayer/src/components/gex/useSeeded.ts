/* A name's book asked for in the background: ready when the live book lands or the ask fails; gives up after 8 s. */

import { useEffect, useState } from 'react';
import { ensureBook } from '../../data/book/load';
import { peekEntry, useBookRev } from '../../data/book/store';

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

