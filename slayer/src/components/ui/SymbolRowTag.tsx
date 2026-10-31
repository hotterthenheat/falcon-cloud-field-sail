/* The quiet tag at the end of a search row: what kind of listing it is (ETF, Index, a preferred or a warrant), and on
   an equity desk whether options are listed on it. A common stock with options carries no tag. */

import { directoryEntry, kindLabel, normalSymbol } from '../../data/symbolDirectory';

interface SymbolRowTagProps {
  symbol: string;
  /** The desk's room: an option desk offers only names with options, so it never says so */
  room?: string;
}

const SymbolRowTag = ({ symbol, room }: SymbolRowTagProps) => {
  const e = directoryEntry(symbol);
  if (!e) return null;
  const parts: string[] = [];
  if (e.kind !== 'stock') parts.push(kindLabel(e.kind));
  if (room !== 'option' && room !== 'compass' && !e.options && (e.kind === 'stock' || e.kind === 'etf')) parts.push('no options');
  if (!parts.length) return null;
  return (
    <span className="ml-auto shrink-0 pl-1 font-mono text-t9 uppercase tracking-wider text-textMuted" data-symbol-tag={symbol}>
      {parts.join(' · ')}
    </span>
  );
};

/** On an option desk, the line for a typed symbol that is listed but has no options ("KO has no listed options …"), or
    null when the query is no such symbol */
export function noOptionsLine(query: string): string | null {
  const q = normalSymbol(query);
  if (!q) return null;
  const e = directoryEntry(q);
  if (!e || e.options) return null;
  return `${e.symbol} has no listed options — this desk needs an options chain.`;
}

export default SymbolRowTag;
