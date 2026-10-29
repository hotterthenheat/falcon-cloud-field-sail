/* The book a Footprints or Watchers page stands on: the market's (or a searched name's) book, held by the pause, cut to
   one expiry, with the contracts that expired at the bell left out. */

import { useMemo } from 'react';
import { standing, useSearchBook } from '../../data/traceLive';
import type { BookContract } from '../../types/trace';
import { useHold } from './LiveHold';
import { searchedName, useSearchedName } from './FlowSearch';
import { useExpiryCut } from './bookExpiry';

export function useHeldBook(query: string, resetKey: unknown, expiry: { value: string | null; onChange: (iso: string | null) => void }) {
  const askedName = useSearchedName(query);
  const bookPack = useSearchBook(askedName);
  const bookWord = bookPack.name ? `${bookPack.name}'s book` : "the market's book";
  const liveBook = bookPack.rows;
  /* not yet is not nothing: a name still being typed, or the first read still out */
  const reading = (bookPack.waiting && liveBook.length === 0) || searchedName(query) !== askedName;
  const hold = useHold(liveBook, resetKey, !reading);
  const heldBook: BookContract[] = hold.value;
  const cut = useExpiryCut(heldBook, r => r.expiry, expiry);
  const stand = useMemo(() => standing(cut.cut(heldBook)), [heldBook, cut]);
  return { bookPack, bookWord, reading, hold, heldBook, expiryCut: cut, stand, book: stand.rows };
}
