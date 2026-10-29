import type { ReactNode } from 'react';

/* Renders a generated sentence with its meaningful tokens lit by the house colour code: signed % and $ in direction inks,
   facts bold, the supply/support families in side inks. Data modules emit plain strings. */

// All-caps words that are jargon, not tickers — never emphasized as symbols
const JARGON = new Set([
  'GEX', 'VEX', 'DEX', 'DP', 'RSI', 'EMA', 'VWAP', 'OI', 'IV', 'ATS', 'ETF',
  'DTE', 'ATM', 'OTM', 'ITM', 'NBR', 'TP', 'TP1', 'TP2', 'TP3', 'TP4', 'AI',
]);

// NB the multiplier branch: \b works after ascii "x" but never after "×"
// (non-word char), so the two spellings need different right edges.
const TOKEN_RE =
  /([Cc]alls \d+(?:\.\d+)?%|[Pp]uts \d+(?:\.\d+)?%|[+]\$\d[\d,]*(?:\.\d+)?[BMK]?|[−-]\$\d[\d,]*(?:\.\d+)?[BMK]?|[+]\d+(?:\.\d+)?%|[−-]\d+(?:\.\d+)?%|\d+(?:\.\d+)?%|\$\d[\d,]*(?:\.\d+)?[BMK]?|\d+(?:\.\d+)?(?:×|x\b)|\d+ (?:lifting|pressing|positive|negative)\b|(?:[Bb]ullish|[Bb]earish|(?:at|on) the ask|(?:at|on) the bid|[Ll]ifting|[Pp]ressing|[Pp]ositive|[Nn]egative|[Aa]ccumulat(?:ion|ing|ive)|[Aa]bsorbed|[Tt]ailwind|[Bb]uy side|[Dd]istribut(?:ion|ing|ive)|[Ss]ell side|[Hh]eadline risk|[Ss]upport|[Rr]esistance|[Ss]upply)\b|\b[A-Z]{2,5}\b)/;

function classFor(token: string): string | null {
  /* a side share ("calls 57%") reads as one lit token; bare counts stay plain */
  if (/^calls \d/i.test(token)) return 'text-bull font-semibold tnum';
  if (/^puts \d/i.test(token)) return 'text-bear font-semibold tnum';
  /* a side is not a direction: at the ask / on the bid wear the plain ink, weighted */
  if (/^(at|on) the ask$/i.test(token)) return 'text-textPrimary font-medium';
  if (/^(at|on) the bid$/i.test(token)) return 'text-textPrimary font-medium';
  /* a signed figure carries its mark (dir-up / dir-down: ▲ ▼ under a colour-vision choice, theme/tokens.css) */
  if (/^[+]\$\d/.test(token)) return 'text-bull dir-up font-semibold tnum';
  if (/^[−-]\$\d/.test(token)) return 'text-bear dir-down font-semibold tnum';
  if (/^bullish$/i.test(token)) return 'text-bull font-medium';
  if (/^bearish$/i.test(token)) return 'text-bear font-medium';
  if (/^[+]\d/.test(token) && token.endsWith('%')) return 'text-bull dir-up font-semibold tnum';
  if (/^[−-]\d/.test(token) && token.endsWith('%')) return 'text-bear dir-down font-semibold tnum';
  if (/^\d/.test(token) && token.endsWith('%')) return 'font-semibold tnum text-textPrimary';
  if (token.startsWith('$')) return 'font-semibold tnum text-textPrimary';
  if (/^\d+(?:\.\d+)?[×x]$/.test(token)) return 'font-semibold tnum text-textPrimary';
  /* the wire's grade words (positive / negative, and the older lifting / pressing) light with their counts */
  if (/^(\d+ )?(lifting|positive)$/i.test(token)) return 'text-bull font-medium tnum';
  if (/^(\d+ )?(pressing|negative)$/i.test(token)) return 'text-bear font-medium tnum';
  if (/^(accumulat|absorbed|tailwind|buy side|support)/i.test(token)) return 'text-bull font-medium';
  if (/^(distribut|sell side|headline risk|resistance|supply)/i.test(token)) return 'text-bear font-medium';
  if (/^[A-Z]{2,5}$/.test(token)) return JARGON.has(token) ? null : 'font-semibold text-textPrimary';
  return null;
}

/* Champion markup: a generator wraps its champion fact in [[...]] and the span renders in the supreme register;
   everything outside tokenizes as usual. */
const SUPREME_RE = /\[\[(.+?)\]\]/;

const tokenize = (text: string, keyBase: string): ReactNode[] =>
  text.split(TOKEN_RE).map((part, i) => {
    if (part === undefined || part === '') return null;
    const cls = classFor(part);
    return cls ? (
      <span key={`${keyBase}-${i}`} className={cls}>
        {part}
      </span>
    ) : (
      <span key={`${keyBase}-${i}`}>{part}</span>
    );
  });

const RichRead = ({ text, className }: { text: string; className?: string }) => {
  const chunks = text.split(SUPREME_RE);
  const nodes: ReactNode[] = chunks.map((chunk, i) =>
    i % 2 === 1 ? (
      <span key={`sup-${i}`} className="text-supreme font-bold tnum">
        {chunk}
      </span>
    ) : (
      tokenize(chunk, String(i))
    )
  );
  return <span className={className}>{nodes}</span>;
};

export default RichRead;
