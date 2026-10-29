/* The cut is the address on every book page: each card reads its value off the validated query string and writes it
   back (replace, never push), only where it differs from the default. */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** A card's field: its default, and the values the address may carry (anything else falls back to the default) */
type CutSpec<K extends string> = Record<K, { def: string; valid: (v: string) => boolean }>;

interface AddressCut<K extends string> {
  /** Every field's value now — the address's, or the default */
  cut: Record<K, string>;
  /** Write some fields; a field set to its default leaves the address */
  set: (patch: Partial<Record<K, string>>) => void;
  /** The cut as a query string, without the '?' — for Link and Save */
  query: string;
  /** Open a saved cut */
  open: (query: string) => void;
}

export function useAddressCut<K extends string>(spec: CutSpec<K>): AddressCut<K> {
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(spec) as K[];
  const cut = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const raw = params.get(k);
      /* A value that passes only in upper case is read in upper case, so a pasted link in any case still lands */
      out[k] = raw === null ? spec[k].def : spec[k].valid(raw) ? raw : spec[k].valid(raw.toUpperCase()) ? raw.toUpperCase() : spec[k].def;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of keys) if (cut[k] !== spec[k].def) p.set(k, cut[k]);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut]);
  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const k of Object.keys(patch) as K[]) {
            const v = patch[k];
            if (v === undefined || v === spec[k].def || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams]
  );
  const open = useCallback((q: string) => setParams(new URLSearchParams(q), { replace: true }), [setParams]);
  return { cut, set, query, open };
}

/** A field that takes any of a fixed list */
export const oneOf = (list: readonly string[]) => (v: string) => list.includes(v);
/** An expiry, YYYY-MM-DD */
export const isIsoDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A search: letters, digits, spaces and dots, as the search field writes it */
/* a whole contract fits ("NVDA 215C 10/30", an OCC symbol of 21) — the field's own rule (FlowSearch) */
export const isQuery = (v: string) => /^[A-Z0-9 ./-]{1,28}$/.test(v);

/** The search in the address (`?q=`) for a page with no other cut there; `memory` keeps it across route changes */
export function useQParam(memory?: { q: string }): [string, (q: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('q');
  const q = raw !== null && isQuery(raw.toUpperCase()) ? raw.toUpperCase() : raw === null && memory ? memory.q : '';
  const set = useCallback(
    (v: string) => {
      if (memory) memory.q = v;
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (v) next.set('q', v);
          else next.delete('q');
          return next;
        },
        { replace: true }
      );
    },
    [setParams, memory]
  );
  return [q, set];
}
