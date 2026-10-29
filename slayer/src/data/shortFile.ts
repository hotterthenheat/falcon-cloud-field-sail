/* A name's own short reads, read whole: these routes answer newest first, so they are read here unclipped, once per
   name a session. */

import { useEffect, useState } from 'react';
import { uwCall } from './whales';

export interface ShortReads {
  si?: unknown;
  rebate?: unknown;
  ftd?: unknown;
  svr?: unknown;
  svx?: unknown;
  /** True until every read has answered or failed */
  waiting: boolean;
}

const ROUTES: Record<Exclude<keyof ShortReads, 'waiting'>, (t: string) => string> = {
  si: t => `/shorts/${t}/interest-float/v2`,
  rebate: t => `/shorts/${t}/data`,
  ftd: t => `/shorts/${t}/ftds`,
  svr: t => `/shorts/${t}/volume-and-ratio`,
  svx: t => `/shorts/${t}/volumes-by-exchange`,
};

const cache = new Map<string, Promise<Omit<ShortReads, 'waiting'>>>();

function readAll(ticker: string): Promise<Omit<ShortReads, 'waiting'>> {
  let hit = cache.get(ticker);
  if (!hit) {
    const t = encodeURIComponent(ticker);
    hit = Promise.all(
      (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).map(k => uwCall(ROUTES[k](t)).then(res => [k, res.error ? null : res.data] as const)),
    ).then(pairs => Object.fromEntries(pairs));
    cache.set(ticker, hit);
  }
  return hit;
}

export function useShortReads(ticker: string): ShortReads {
  const [got, setGot] = useState<ShortReads>({ waiting: true });
  useEffect(() => {
    if (!ticker) return;
    let dead = false;
    setGot({ waiting: true });
    void readAll(ticker.toUpperCase()).then(r => {
      if (!dead) setGot({ ...r, waiting: false });
    });
    return () => {
      dead = true;
    };
  }, [ticker]);
  return got;
}
