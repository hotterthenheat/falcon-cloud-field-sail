/*
==================================================
  SLAYER TERMINAL - THE SPOT ROW'S PILL, ON THE
  ROOM'S PRICE (components/gex/RoomSpotRule.tsx)

  One price on the page (the owner, 2026-10-14):
  the pill between the strikes reads the room's
  price now (pages/pinpoint/useRoomScan.ts
  useRoomSpot) — the head's figure — and it alone
  re-renders on the tick; the grid round it moves
  only when the price crosses a strike.
==================================================
*/

import SpotRule from '../ui/SpotRule';
import { useRoomSpot } from '../../pages/pinpoint/useRoomSpot';

const RoomSpotRule = ({ ticker, fallback, centre = false, live = true }: { ticker: string; /** The book's own spot, for a name the room has no price for yet — and the replayed minute's while a replay runs */ fallback: number; centre?: boolean; /** False while the book is a replayed minute's: the pill reads that minute, not the room */ live?: boolean }) => {
  const spot = useRoomSpot(ticker, live);
  return <SpotRule ticker={ticker} price={spot ?? fallback} centre={centre} />;
};

export default RoomSpotRule;
