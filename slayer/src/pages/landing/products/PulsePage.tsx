/*
  Pulse's product page: the desk, its widgets and desks, and one recording.
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Picture } from './ProductPage';

const SHOTS = '/landing/products/pulse';

/* The five house desks, in the bar's order, with the desk's own line (desks.ts PRESET_BLURBS — copied, not
   imported: the desks file brings every tile's code with it, and this page is the landing's chunk) */
const DESKS: { name: string; file: string; says: string }[] = [
  { name: 'The session', file: 'the-session', says: 'The working desk: the chart, the book as a matrix beside it, where the walls are heading and the key levels beneath.' },
  { name: 'The open', file: 'the-open', says: 'Before the bell and the first hour: the chart, the book across the calendar, the levels, the wire and who reports.' },
  { name: '0DTE', file: '0dte', says: 'Today’s expiry: a one-minute chart, today’s book, the strikes that matter and the key levels.' },
  { name: 'The close', file: 'the-close', says: 'The last hour: the chart, where the walls are heading by the close, the strikes that matter and the levels.' },
  { name: 'My book', file: 'my-book', says: 'What you hold and watch: positions and watchlist, the chain, the setups that fit the levels and the levels themselves.' },
];

/* The recording's three lines — what the film shows, in the order it shows it */
const ARRANGE: { word: string; says: string }[] = [
  { word: 'Drag', says: 'Take a tile by its head. The spot it will land on shows in silver, and it drops into the open space when you let go.' },
  { word: 'Size', says: 'Pull any corner. The tile fits what you give it — a chart redraws to the box, a list shows as many rows as fit.' },
  { word: 'Open', says: 'Press the arrow on a tile and its whole page opens, with Back to Pulse at the top until you press it.' },
];

const PulsePage = () => (
  <ProductPage
    name="Pulse"
    glyph="pulse"
    group="Home"
    head={['The live desk.', 'Tiles you add, move and size.']}
    intro={
      <>
        Pulse is a grid of live tiles. Each tile is one thing from the terminal — the chart, the dealer book across the calendar, the key levels, the news wire, who reports this week — on the terminal’s name or a name of its own,
        with one line under it that says in words what it is showing. You add the tiles you want, drag them where you want them and pull them to the size you want. The desk saves as you go, so it is how you left it when you come
        back.
      </>
    }
    path="/pulse"
    plan="It is in every plan."
  >
    {/* ── a tile, up close ── */}
    <Aside
      eyebrow="A tile"
      first="A tile holds one thing."
      second="And one line that says what it shows."
      picture={<Picture src={`${SHOTS}/tiles`} alt="Two tiles of the desk up close: Key levels on QQQ, and the news wire" ratio="1800 / 807" />}
    >
      <p>
        A tile holds one instrument and nothing else: the key levels for one name, the news wire, this week’s earnings. Its head carries the name it follows — the terminal’s, or one you give this tile alone — the controls that
        matter for it, the arrow that opens its whole page, and a menu.
      </p>
      <p>
        Under the instrument stands one line in plain words. <em className="not-italic text-textPrimary">QQQ is above the flip at 411.50, where dealer hedging slows moves down. The call wall is 413, the put wall 410.</em> It is
        there so a glance tells you where things stand before you read a number.
      </p>
    </Aside>

    {/* ── the one recording ── */}
    <Arrange />

    {/* ── the list of tiles ── */}
    <Aside
      eyebrow="The list"
      first="Seventeen tiles to pick from."
      second="In three groups."
      flip
      picture={<Picture src={`${SHOTS}/picker`} alt="The list of tiles, open under the Add widget button, with the live chart picked" ratio="1200 / 834" />}
    >
      <p>
        Add widget opens the list. <span className="text-textPrimary">Market</span> holds the live chart, news, earnings, stocks, insiders and Congress, and the session clock. <span className="text-textPrimary">The book</span> holds
        the book itself, the key levels, targets, where the walls are heading, and head to head. <span className="text-textPrimary">Trade</span> holds Compass setups, the chain, and your
        positions and watchlist.
      </p>
      <p>A search at the top finds one by name. A tile is added with a press, or dragged straight off the list onto the spot you want it.</p>
    </Aside>

    {/* ── THE DESKS ── */}
    <div data-product-desks>
      <div className="max-w-[72ch]">
        <Eyebrow>The desks</Eyebrow>
        <Head className="mt-5" first="Five desks to start from." second="Or save one of your own." />
        <p className="mt-6 text-t155 leading-relaxed text-textSecondary">
          The bar at the top holds the house’s five desks, each laid out for a part of the day. Change one and it keeps your change; Reset puts the house’s back. Save as names the desk you have, and it takes its place on the bar
          beside them.
        </p>
      </div>
      <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-5 gap-y-8">
        {DESKS.map(d => (
          <li key={d.name} className="min-w-0" data-product-desk={d.name}>
            <Picture src={`${SHOTS}/desk-${d.file}`} alt={`The ${d.name} desk`} ratio="1440 / 1000" />
            <p className="mt-3 text-t14 font-medium text-textPrimary">{d.name}</p>
            <p className="mt-1 text-t13 leading-snug text-textSecondary">{d.says}</p>
          </li>
        ))}
      </ul>
    </div>
  </ProductPage>
);

/** THE RECORDING: the desk arranged — the window plays the page's own film of it, and three lines under it say what it shows */
const Arrange = () => {
  const { a } = useGround();
  return (
    <div data-product-film="pulse-arrange">
      <div className="max-w-[72ch]">
        <Eyebrow>Arranging it</Eyebrow>
        <Head className="mt-5" first="Moving tiles around." second="You drag a tile, pull one wider, and open one." />
      </div>
      <TerminalWindow path="/pulse" theme={a} desk natural film="pulse-arrange" className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {ARRANGE.map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-t11 uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-t145 leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PulsePage;
