/* The sessions layer on one chart (sessionsPrimitive.ts over data/sessionMarks.ts): the extended-hours wash and the
   session breaks (Overlays, on by default), and the Sessions indicator's Tokyo / London / New York boxes (Indicators,
   with an Inputs tab per session). Intraday time bars only. The primitive hangs on the main series and follows it
   when a style swap replaces that series. */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import type { Candle } from '../../types/market';
import type { WorldSessionKey } from '../../core/session';
import { readToken } from '../../theme/theme';
import { sessionMarks } from '../../data/sessionMarks';
import { SessionsPrimitive, type SessionInks } from './sessionsPrimitive';

/** The Sessions indicator's per-session switches (indicatorItems.ts, the Inputs tab), in draw order */
export const SESSION_INPUT_KEYS: { id: string; key: WorldSessionKey }[] = [
  { id: 'asia', key: 'asia' },
  { id: 'london', key: 'london' },
  { id: 'newYork', key: 'newYork' },
];

function inksNow(opacity: number): SessionInks {
  const box = (token: string) => ({ fill: readToken(token, 0.07 * opacity), edge: readToken(token, 0.5 * opacity), word: readToken(token, 0.9) });
  return {
    shade: { pre: readToken('--select', 0.06), post: readToken('--moon', 0.07), overnight: readToken('--ink', 0.035) },
    rule: readToken('--ink', 0.2),
    box: { asia: box('--moon'), london: box('--select'), newYork: box('--warn') },
  };
}

export function useSessionsLayer(
  seriesRef: MutableRefObject<ISeriesApi<SeriesType> | null>,
  o: { bars: () => Candle[]; off: boolean; ext: boolean; breaks: boolean; boxes: WorldSessionKey[]; opacity: number; signature: string },
) {
  const primRef = useRef<SessionsPrimitive | null>(null);
  const onRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const boxesKey = o.boxes.join(',');
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!primRef.current) primRef.current = new SessionsPrimitive();
    const prim = primRef.current;
    if (onRef.current !== series) {
      /* the old series went with a style swap (its primitives with it); hang on the new one */
      if (onRef.current) {
        try {
          onRef.current.detachPrimitive(prim);
        } catch {
          /* already removed */
        }
      }
      series.attachPrimitive(prim);
      onRef.current = series;
    }
    if (o.off || (!o.ext && !o.breaks && !o.boxes.length)) {
      prim.set(null, null);
      return;
    }
    prim.set(sessionMarks(o.bars(), { ext: o.ext, breaks: o.breaks, boxes: o.boxes }), inksNow(o.opacity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.off, o.ext, o.breaks, boxesKey, o.opacity, o.signature]);
}
