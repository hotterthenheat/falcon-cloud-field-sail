/*
  The latest live spot per name, readable without loading the Trace data module. data/traceLive.ts registers its
  reader when it loads; until then (on pages that never load it) every name reads 0, and callers keep their own spot.
*/

let reader: (ticker: string) => number = () => 0;

export function registerLiveSpots(read: (ticker: string) => number): void {
  reader = read;
}

export const liveSpotOf = (ticker: string): number => reader(ticker);
