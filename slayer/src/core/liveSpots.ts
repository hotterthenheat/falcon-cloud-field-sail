/* The latest live spot per name without loading Trace's data module: traceLive.ts registers its reader on load; until then every name reads 0. */

let reader: (ticker: string) => number = () => 0;

export function registerLiveSpots(read: (ticker: string) => number): void {
  reader = read;
}

export const liveSpotOf = (ticker: string): number => reader(ticker);
