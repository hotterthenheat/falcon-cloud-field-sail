import { useResolvedTheme } from '../../theme/theme';

interface SpotRuleProps {
  ticker: string;
  price: number;
  /** The pill in the MIDDLE of the rule, the line running out both ways — the book's two views (Noah, 2026-10-12:
      "the ticker price thing to be in the middle and not far left or right for both matrix and calendar") */
  centre?: boolean;
}

/**
 * Current-price marker: a rule with the price in a pill — the TradingView
 * price-label idiom. Shared by every strike list the live price crosses.
 * The pill = "where the market is".
 *
 * THE PILL WEARS THE HOLO (Noah, 2026-10-15: "these tickers should have the
 * holo silver color changing not white"): the house's living foil with dark
 * words on the dark terminal, its galaxy counterpart with light words on
 * paper (the landing's buttons' pairing) — silver is where-you-are, and it
 * pans. Before it was the primary ink inverted (a white pill, dark figures;
 * a literal dark text vanished on paper, found 2026-09-13).
 */
const SpotRule = ({ ticker, price, centre = false }: SpotRuleProps) => {
  const paper = useResolvedTheme() === 'light';
  return (
  <span className={`flex items-center gap-1.5 select-none ${centre ? 'w-full' : ''}`} aria-label={`${ticker} spot ${price.toFixed(2)}`}>
    <span className="h-px flex-grow bg-gradient-to-r from-textPrimary/10 via-textPrimary/40 to-textPrimary/50" />
    <span className="min-w-0 truncate font-mono text-t11 uppercase tracking-wider text-textSecondary whitespace-nowrap" title={ticker}>{ticker}</span>
    {/* the price never gives way in a narrow box (a pane's side panel); the ticker beside it can */}
    <span className={`relative foil-glide shrink-0 inline-flex items-center rounded-[3px] px-1.5 py-px font-mono text-t11 font-bold tnum whitespace-nowrap ${paper ? 'galaxy-bg' : 'holo-bg text-onfoil'}`} data-spot-pill>
      {price.toFixed(2)}
    </span>
    {centre ? (
      <>
        {/* the ticker's width again, unseen, so the PILL is at the middle — not the pair (Noah, 2026-10-12: "centered
            in the middle in relation to the amount of nodes") */}
        <span aria-hidden className="invisible font-mono text-t11 uppercase tracking-wider whitespace-nowrap">{ticker}</span>
        <span className="h-px flex-grow bg-gradient-to-l from-textPrimary/10 via-textPrimary/40 to-textPrimary/50" />
      </>
    ) : (
      <span className="h-px w-3 shrink-0 bg-textPrimary/50" />
    )}
  </span>
  );
};

export default SpotRule;
