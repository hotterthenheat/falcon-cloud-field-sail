/*
==================================================
  SLAYER TERMINAL - COMPASS, ON ITS OWN PAGE
  (pages/landing/products/CompassPage.tsx)

  The product page for Compass (Noah, 2026-10-03:
  "now create the compass product page"). One
  product in the terminal, read top to bottom: the
  board with its rail; the four choices over it;
  the ONE recording (the tour's own film: the rail
  ranked four ways, a card opened on its page, the
  floor and the targets hovered, Setup and Contract,
  the board on another kind and one name); the
  setup's page; its chart with the marks; the card's
  tabs; the contract and the ones around it; the
  Tracker. Every picture is the real page
  (scripts/make-product-shots.mjs, `compass`).
==================================================
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Pair, Picture, Room } from './ProductPage';

const SHOTS = '/landing/products/compass';

/** the recording's three lines — what Compass's film shows */
const FILM: { word: string; says: string }[] = [
  { word: 'The rail', says: 'Heaviest contracts, ranked by whichever column you press: gamma, volume against open interest, distance from spot, exposure. A row opens that contract’s page.' },
  { word: 'The page', says: 'A press on the picked card opens its page on Why we chose this. The pointer runs down the floor and the targets at the chart’s edge and each one says what it is; then Setup, then Contract.' },
  { word: 'The board', says: 'Back on the board, the Kind turns to every kind and the Name to the busiest one, so the board is one name’s cards only. Then back, and the card picked again.' },
];

const CompassPage = () => (
  <ProductPage
    name="Compass"
    glyph="compass"
    group="Trade"
    head={['Contracts picked off today’s levels.', 'With the reason for each.']}
    intro={
      <>
        Compass sweeps the option chains against today’s levels and keeps a board of the contracts that clear the bar — 0DTE to long-dated, calls and puts, each one a card with its state, its premium and the move it needs.
        Pick a card and you get the whole case on one page: the chart with the entry, the floor and the targets drawn on it, the reasons it made the board, and the contracts around it. Track the ones you like and the
        Tracker keeps their live figures as the session moves.
      </>
    }
    path="/compass"
    plan="It comes with Desk."
  >
    {/* ── THE BOARD ── */}
    <Aside eyebrow="The board" first="Every card is a contract." second="With its reason and its state." picture={<Picture src={`${SHOTS}/board`} alt="The board: the sweep's facts and its one-line read across the top, the cards two across under them, and the Heaviest contracts rail beside them" ratio="1440 / 953" />}>
      <p>
        The board is one box. Across its head, what the sweep found: how many setups cleared the bar, how many are active, proving or fading, the top pick, and when the sweep ran. Under that, one line that says it in
        words. Then the cards, two across, newest sweep first.
      </p>
      <p>
        A card is a contract and its case: the name and the strike in the side’s ink, its state, the premium, the move the stock has priced for the period, where it breaks, and how the targets stand. One press selects
        it; a second opens its page. The states say where a setup is in its life: watch, active, moving, fading — and retired once its floor breaks.
      </p>
    </Aside>

    {/* ── THE FOUR CHOICES ── */}
    <Room
      eyebrow="The four choices"
      first="Four choices at the top."
      second="Expiry, kind, name and layout."
      pictures={
        <Pair items={[
          { src: `${SHOTS}/kind-open`, ratio: '1034 / 519', name: 'The kind', says: 'What found the setup: Top ranked, Quick scalp, Discounted, Rebounds, Breakouts, Trend continuation, Volatility expansion, Mean reversion, Unusual activity, Overpriced, Earnings, or every setup at once. Each row carries its count for the expiry in hand, and says when a kind is limited on it.' },
          { src: `${SHOTS}/name-open`, ratio: '1034 / 573', name: 'The name', says: 'Every name on the sweep with how many setups it holds, and a search box that is focused the moment the card opens. Type two letters and press Enter.' },
        ]} />
      }
    >
      <p>
        Four cards sit over the board and none of them leaves it. Expiry is a named choice — same day, this week, a six-week swing, a year out — because a trade’s length is a decision, not a date. Kind is the lens
        that found the setup. Name narrows the board to one ticker. Layout turns the cards into a table with the same rows, sortable by any head.
      </p>
    </Room>

    {/* ── THE ONE RECORDING ── */}
    <Film />

    {/* ── THE SETUP'S PAGE ── */}
    <Aside eyebrow="The setup’s page" first="A setup’s own page." second="The chart, the case and the contract." flip picture={<Picture src={`${SHOTS}/setup`} alt="A setup's own page: the head with the contract, its state and its facts, the chart with the marks beside the card on Why we chose this" ratio="1440 / 1000" />}>
      <p>
        Every setup has an address of its own, so the browser’s Back works and a link lands on it. The head carries the contract in its side’s ink, its state and the expiry, and the facts a trader asks first: the
        premium live, how the case stands, how many targets have been hit, where it breaks, and how tight the market is. Under it, the chart and the card share the screen; under them, the contracts around it. The
        way back to the board is the first thing on the page.
      </p>
    </Aside>

    {/* ── THE CHART ── */}
    <Aside eyebrow="The chart" first="The marks on the chart." second="The entry, the floor and the targets." picture={<Picture src={`${SHOTS}/chart`} alt="The setup's chart: a silver arrow on the entry candle, a thin red rule for the floor, and the targets as a ladder of green rungs at the right edge" ratio="1193 / 1080" />}>
      <p>
        The marks stay out of the candles’ way. The entry is a silver arrow on its candle, pointing the trade’s way, with a chip at the edge. The floor is a thin red rule that stops at the candle that broke it. The
        targets are a ladder of rungs at the right edge, numbered, each one filled once it is won. Bring the pointer near any of them and a small card says which it is, what it stands at, how far from spot it is and
        whether it has been hit. The strip over the chart turns between the stock and the contract’s premium, and the two views cross-fade rather than reload.
      </p>
    </Aside>

    {/* ── THE CARD ── */}
    <Room eyebrow="The card" first="Why we chose this." second="The card opens on the reason." pictures={<Pair cols={3} items={[
      { src: `${SHOTS}/why`, ratio: '854 / 1080', name: 'Why we chose this', says: 'The tab the card opens on. The state, the case and the lens that found it; why it is on the board, with the numbers behind that read as rows — priced against fair value, the move it needs, which side the dealers are on, the clock, the greeks, the liquidity; and what would make us wrong.' },
      { src: `${SHOTS}/setup-tab`, ratio: '854 / 1080', name: 'Setup', says: 'The plan as a table: the entry, each target with its price and whether it has been hit, and the floor — the price that retires the setup if it trades through. Track setup lives in the foot, with the door to the Tracker.' },
      { src: `${SHOTS}/contract-tab`, ratio: '854 / 1080', name: 'Contract', says: 'The premium against fair value, the expected move into expiry, the greeks, and the whole thing in dollars for one contract — what it costs, what the targets pay, what the floor costs.' },
    ]} />}>
      <p>
        The card beside the chart speaks in three tabs, and it opens on the reason. That order was deliberate: before the numbers, the case in plain words, so a card can be dismissed in a sentence or earn the rest of
        your attention.
      </p>
    </Room>

    {/* ── THE CONTRACTS AROUND IT ── */}
    <Aside eyebrow="The contracts around it" first="The contracts around it." second="The strikes beside the setup." flip picture={<Picture src={`${SHOTS}/drivers`} alt="The contracts around the setup: the heaviest strikes on the same name as rows, the setup's own row selected, with each one's role, gamma, volume against open interest, distance from spot and exposure" ratio="1400 / 556" />}>
      <p>
        The strikes on the same name that carry the most weight sit under the chart as rows, with the setup’s own row selected: each one’s role, its gamma, its volume against open interest, how far it sits from spot,
        and its exposure. They are why the levels are where they are. Open any of them and the page turns to that contract, with the way back kept.
      </p>
    </Aside>

    {/* ── THE TRACKER ── */}
    <Room eyebrow="The Tracker" first="The setups you follow." second="Each with its live figures." pictures={<Pair items={[
      { src: `${SHOTS}/tracker-cards`, ratio: '1400 / 352', name: 'As cards', says: 'Every setup you pressed Track on, rebuilt live each tick: the contract, its state, the premium now against the entry, and how the targets stand. A card opens its page.' },
      { src: `${SHOTS}/tracker-table`, ratio: '1400 / 455', name: 'As a table', says: 'The same list as rows, when you want them side by side and sorted by any head. One list, two views — never two lists.' },
    ]} />}>
      <p>
        Track a setup from its page and it joins the Tracker, one of Compass’s own pages. The contracts you merely watch live on the Weigher; the Tracker holds setups, each with the case it was tracked on and
        where it stands now.
      </p>
    </Room>
  </ProductPage>
);

/** THE RECORDING: Compass in use — the tour's own film, with three lines under it */
const Film = () => {
  const { a } = useGround();
  return (
    <div data-product-film="compass">
      <div className="max-w-[72ch]">
        <Eyebrow>In use</Eyebrow>
        <Head className="mt-5" first="From the rail to a card and back." second="You rank the rail, open a card and change the board." />
      </div>
      <TerminalWindow path="/compass" theme={a} desk natural className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {FILM.map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CompassPage;
