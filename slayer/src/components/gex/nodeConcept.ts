/* Which look the exposure nodes wear on the chart. Three candidates sit behind a dev-only switch until the owner picks
   one; a production build always draws `current`.

     ?nodes=current|strata|ridge|glyphs   in the URL (kept in localStorage, so it survives a navigation), or
     localStorage['slayer_nodes_concept'] = 'strata'                                    */

export type NodeConcept = 'current' | 'strata' | 'ridge' | 'glyphs';
export const NODE_CONCEPTS: readonly NodeConcept[] = ['current', 'strata', 'ridge', 'glyphs'];
export const NODE_CONCEPT_KEY = 'slayer_nodes_concept';

const isConcept = (v: unknown): v is NodeConcept => typeof v === 'string' && (NODE_CONCEPTS as readonly string[]).includes(v);

/** The look to draw: the URL's, then the stored one, then `current`. Always `current` outside a dev build. */
export function nodeConcept(): NodeConcept {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return 'current';
  try {
    const asked = new URLSearchParams(window.location.search).get('nodes');
    if (isConcept(asked)) {
      localStorage.setItem(NODE_CONCEPT_KEY, asked);
      return asked;
    }
    const kept = localStorage.getItem(NODE_CONCEPT_KEY);
    return isConcept(kept) ? kept : 'current';
  } catch {
    return 'current';
  }
}
