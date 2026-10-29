/*
  Compass's product page: the board with its rail, the choices over it, one recording, and the card and the rules.
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
  { word: 'The board', says: 'Back on the board, the Name narrows it to one name’s cards. Then back, and the card picked again.' },
];

const CompassPage = () => (
  <ProductPage
    name="Compass"
    glyph="compass"
    group="Trade"
    head={['Contracts picked off today’s levels.', 'With the reason for each.']}
    intro={
      <>
        Compass scores the option chains on the ThetaData terminal’s live quotes with two trained models at every mark of every session a root trades — overnight, pre-market, from the 09:30 open every five minutes, and through the close — and keeps a board of the calls that clear the bar and the closest misses —
        same day and one to seven days out. Every call goes to the blotter the moment it fires, with the quote it fired on, and is filled and closed by fixed rules on the quotes that follow. A call opens its own page:
        the live chart with the entry, the stop and the exits on it, the quote and its greeks.
      </>
    }
    path="/compass"
    plan="It comes with Desk."
  >
    {/* ── THE BOARD ── */}
    <Aside eyebrow="The board" first="Every card is a call." second="With the rules it fired and closes on." picture={<Picture src={`${SHOTS}/board`} alt="The board: the sweep's facts and its one-line read across the top, the cards two across under them, and the Heaviest contracts rail beside them" ratio="1440 / 953" />}>
      <p>
        The board is one box. Across its head, what the scan found today: how many calls fired, the best Model 1 read against the bar a call needs, how many came closest, and how many of the five seats are taken. Then
        the cards, two across, newest first.
      </p>
      <p>
        A call needs Model 1 at 70.67% or more, a bid over $0.15 and a spread at or under 8%. It fills at the ask of the first quote a full minute after the call, and closes on the stop, the take-profit, a reversal of the
        underlying or the 15:55 ET flat — each read off a quote that printed. The Book A and Book B calls are marked unvalidated until the live model inputs are re-checked against training.
      </p>
    </Aside>

    {/* ── the four choices ── */}
    <Room
      eyebrow="The four choices"
      first="Four choices at the top."
      second="Expiry, type, name and layout."
      pictures={
        <Pair items={[
          { src: `${SHOTS}/name-open`, ratio: '1034 / 573', name: 'The name', says: 'Every name on the sweep with how many setups it holds, and a search box that is focused the moment the card opens. Type two letters and press Enter.' },
        ]} />
      }
    >
      <p>
        The choices sit over the board and none of them leaves it. Expiry is same day or one to seven days out. Type is calls, puts or both. Name narrows the board to one ticker. Layout turns the cards into a table with the
        same rows, sortable by any head.
      </p>
    </Room>

    {/* ── the one recording ── */}
    <Film />

    {/* ── the setup's page ── */}
    <Aside eyebrow="The call’s page" first="A call’s own page." second="The chart, the quote and the contract." flip picture={<Picture src={`${SHOTS}/setup`} alt="A setup's own page: the head with the contract, its state and its facts, the chart with the marks beside the card on Why we chose this" ratio="1440 / 1000" />}>
      <p>
        Every call has an address of its own, so the browser’s Back works and a link lands on it. The head carries the contract in its side’s ink, the call’s state and the expiry, and the quote live from the terminal:
        the bid and ask, the spread, the greeks. The way back to the board is the first thing on the page.
      </p>
    </Aside>

    {/* ── THE CHART ── */}
    <Aside eyebrow="The chart" first="The marks on the chart." second="The entry, the stop and the exits." picture={<Picture src={`${SHOTS}/chart`} alt="The setup's chart: a silver arrow on the entry candle, a thin red rule for the floor, and the targets as a ladder of green rungs at the right edge" ratio="1193 / 1080" />}>
      <p>
        The marks stay out of the candles’ way. The entry is a silver arrow on its candle, pointing the trade’s way, with a chip at the edge. The stop is a thin red rule; the exits stand at the right edge. Bring the
        pointer near any of them and a small card says which it is and what it stands at. The strip over the chart turns between the stock and the contract’s premium.
      </p>
    </Aside>

    {/* ── THE TRACKER ── */}
    <Room eyebrow="The Tracker" first="The calls you follow." second="Each where it stands now." pictures={<Pair items={[
      { src: `${SHOTS}/tracker-cards`, ratio: '1400 / 352', name: 'As cards', says: 'Every call you pressed Track on: the contract, its state and the premium now against the entry. A card opens its page.' },
      { src: `${SHOTS}/tracker-table`, ratio: '1400 / 455', name: 'As a table', says: 'The same list as rows, when you want them side by side and sorted by any head. One list, two views — never two lists.' },
    ]} />}>
      <p>
        Track a call from its page and it joins the Tracker, one of Compass’s own pages. The contracts you merely watch live on the Weigher; the Tracker holds Compass’s calls, each with where it stands now.
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
            <p className="font-mono text-t11 uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-t145 leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CompassPage;
