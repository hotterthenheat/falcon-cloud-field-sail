/*
==================================================
  SLAYER TERMINAL - THE WEIGHER, ON ITS OWN PAGE
  (pages/landing/products/WeigherPage.tsx)

  The product page for the Weigher (Noah,
  2026-10-02: "now do weigher"; and earlier that
  day, of this page: "for the detailed section of
  the weigher we will have screenshots of the add
  a position, and how to add to watchlist"). One
  desk in the terminal, read here top to bottom:
  the desk whole; the chain with a strike open and
  the book at it; the ONE recording (the tour's own
  film: the ruler dragged, by price and by date,
  another position opened); the position card by
  date and by price; the two lists; then the two
  things he asked for as pictures — adding a
  position, and adding a contract to the watchlist.
  Every picture is the real page (scripts/
  make-product-shots.mjs, `weigher`).
==================================================
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Pair, Picture, Room } from './ProductPage';

const SHOTS = '/landing/products/weigher';

/** the recording's four lines — what the Weigher's film shows */
const FILM: { word: string; says: string }[] = [
  { word: 'The case', says: 'Open a strike and its dropdown starts with the case for it: one word and one line, what speaks for it and against it, what has to happen by when, and if not this one, which. Press the other strike and the chain opens on its case.' },
  { word: 'The ruler', says: 'Drag the price ruler under the curve and the return reads at that price, to the cent. The market’s own price is the lime dash; slide past it and a capsule offers the way back.' },
  { word: 'By date, by price', says: 'By date is the return over the sessions to expiry at the chosen price. By price is the payoff curve with the chosen price pinned on it.' },
  { word: 'Another position', says: 'Press a row of the list and the card turns to it: the chart, the ruler, the figures and the facts of that contract.' },
];

const WeigherPage = () => (
  <ProductPage
    name="Weigher"
    glyph="weigher"
    group="Trade"
    head={['One desk for any contract.', 'And what it would return at every price.']}
    intro={
      <>
        The Weigher is one desk for the contracts you care about. The chart and the chain on top, with every strike carrying the dealer book behind it; under them, your positions and your watchlist, and the card for whichever
        one you press. The card is simulated returns the way a trader actually asks the question: what does this contract make or lose if the stock is here, by then — with a ruler you drag by the cent and a curve that
        moves with it. A contract on the watchlist is marked at the price the moment you add it and tracked from there as if bought.
      </>
    }
    path="/weigher"
    plan="It comes with Desk."
  >
    {/* ── THE DESK ── */}
    <Aside eyebrow="The desk" first="The chart, the chain, the lists and the card." second="On one page." picture={<Picture src={`${SHOTS}/desk`} alt="The Weigher's desk: the chart and the chain on top, your positions and the watchlist under them, and the position card at the right" ratio="1360 / 1208" />}>
      <p>
        Pick a name and the chart and the chain turn to it. Pick a strike and its row opens on the contract. Press a row of your positions or your watchlist and the card at the bottom right becomes that contract. The two top
        cards go fullscreen when you want the room; the sash between the rows is yours to drag.
      </p>
    </Aside>

    {/* ── THE CHAIN ── */}
    <Aside eyebrow="The chain" first="Every strike carries its book." second="Open one and it makes its case." flip picture={<Picture src={`${SHOTS}/chain`} alt="The chain with a strike open: the case for it — the word, the line, what speaks for it and against it, what has to happen — and under it the stats, the greeks and the book at that strike" ratio="1028 / 430" />}>
      <p>
        The strike column isn’t just a number. Each one carries a chip for the shape of the dealer book at that strike and a net bar at its foot, so a wall reads as a wall before you open anything. Open a strike and it unfolds
        on the case for it: one word, one line, what speaks for it and what stands against it, the move it needs by when with the levels in the way, and if not this one, which — the other strike and the other expiry as doors,
        the same strike down the calendar, and what to watch for the horizon the expiry sets. Under the case, the stats, the greeks and the book at that strike. The + at the row’s end adds the contract to the watchlist at that
        moment’s price.
      </p>
    </Aside>

    {/* ── THE ONE RECORDING ── */}
    <Film />

    {/* ── THE CARD ── */}
    <Room eyebrow="The card" first="What a position would return." second="By date, and by price." pictures={<Pair items={[
      { src: `${SHOTS}/card-date`, ratio: '1028 / 822', name: 'By date', says: 'The return over the sessions left to expiry, at the price the ruler is on. The dashed floor is the most a bought contract can lose. The figure at the top is today’s, with the estimated contract price beside it.' },
      { src: `${SHOTS}/card-price`, ratio: '1028 / 822', name: 'By price', says: 'The payoff curve across price, with the ruler’s price pinned on it and the market’s levels — the put wall, the flip, the call wall — standing on the ruler, since a price is where they live.' },
    ]} />}>
      <p>
        The card answers the question a position raises: what is it worth if the stock goes here, by then. The ruler under the chart is the stock’s price; drag it and the return, the estimated contract price and the curve
        all move by the cent. Under the chart, what the position has done since you added or bought it, and the verdict on how dealers are hedging against it — with you, against you, or both ways.
      </p>
    </Room>

    {/* ── THE LISTS ── */}
    <Room eyebrow="The lists" first="Your positions." second="And the contracts you watch." pictures={<Pair items={[
      { src: `${SHOTS}/positions`, ratio: '1028 / 582', name: 'Your positions', says: 'The contracts you own or sold, with what you paid, the mark now, today’s change and the whole return in dollars and in R. Add one from the door in the card’s head.' },
      { src: `${SHOTS}/watchlist`, ratio: '1028 / 255', name: 'The watchlist', says: 'The contracts you watch, each marked at the price the moment it was added and tracked from there as if bought — so a week later you know what the idea would have made. The same card can turn into the scanner.' },
    ]} />}>
      <p>Two cards in the left column, newest first. Press any row and the card at the right becomes it; a row’s × takes it off the list.</p>
    </Room>

    {/* ── ADDING A POSITION ── */}
    <Aside eyebrow="Adding a position" first="Adding a position." second="One form: strike, side, size, expiry, price." narrow flip picture={<Picture src={`${SHOTS}/add-position`} alt="The Add a position form: the strike, call or put, the number of contracts, the expiry with quick picks, and what you paid" ratio="1028 / 582" />}>
      <p>
        Press Add a position in the head of Your positions and a short form opens on the desk’s name: the strike, call or put, how many contracts, the expiry — with quick picks for this Friday, next Friday and the monthly —
        and what you paid a contract. Save, and the position is on the list and on the card, priced at the market from then on. Leave the price blank and it is marked at the tick you added it.
      </p>
    </Aside>

    {/* ── ADDING TO THE WATCHLIST ── */}
    <Room eyebrow="Adding to the watchlist" first="Watching a strike." second="One press, and it is on the list, marked." pictures={<Pair items={[
      { src: `${SHOTS}/watch-chain`, ratio: '1028 / 570', name: 'The + on the strike', says: 'Every row of the chain ends in a +. Press it and that contract goes on the watchlist, marked at this tick’s price. The + turns to a mark once it is watched, and the card for a strike that isn’t watched yet offers the same door in its foot.' },
      { src: `${SHOTS}/watchlist`, ratio: '1028 / 255', name: 'Where it lands', says: 'The watchlist card, newest first: the contract, when it was added, the mark then and now, today and the whole run in dollars and in R. Press the row and the card turns to it; Close settles it at the mark and keeps the row as closed by hand.' },
    ]} />}>
      <p>Watching a contract costs nothing and asks nothing but a press. From that moment the list carries what it would have made, and the card can be opened on it at any time.</p>
    </Room>
  </ProductPage>
);

/** THE RECORDING: the Weigher in use — the tour's own film, with three lines under it */
const Film = () => {
  const { a } = useGround();
  return (
    <div data-product-film="weigher">
      <div className="max-w-[72ch]">
        <Eyebrow>In use</Eyebrow>
        <Head className="mt-5" first="A strike opened, the ruler moved." second="The case unfolds, and the curve follows your hand." />
      </div>
      <TerminalWindow path="/weigher" theme={a} desk natural className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-10 gap-y-5 border-t border-borderSubtle">
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

export default WeigherPage;
