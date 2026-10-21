/*
==================================================
  SLAYER TERMINAL - TERRAIN, ON ITS OWN PAGE
  (pages/landing/products/TerrainPage.tsx)

  The product page for Terrain (Noah, 2026-10-03:
  "make the one for terrain" — Alerts gets none,
  at his word the same day). One desk in the
  terminal, read top to bottom: the desk whole;
  one set of controls (a pane's strip, the desk
  bar); the ONE recording (the tour's own film:
  the crosshair down a chart, the strike rail
  read, turned to its net and back, the desk to
  one chart and back to two); the strike rail;
  the drawing tools; your own scripts; replay.
  Every picture is the real page (scripts/
  make-product-shots.mjs, `terrain`).
==================================================
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Pair, Picture, Room } from './ProductPage';

const SHOTS = '/landing/products/terrain';

/** the recording's three lines — what Terrain's film shows */
const FILM: { word: string; says: string }[] = [
  { word: 'The chart', says: 'The crosshair down a chart: the price, the time and the exposure under every candle read off the axes as it goes. Nothing is named on the tape until you ask for it.' },
  { word: 'The rail', says: 'The strike rail read strike by strike, then turned to its net view and back. The same book, two ways of seeing where it is heaviest.' },
  { word: 'The desk', says: 'The desk taken to one chart and back to two from the bar at the foot. Each pane keeps its own name, timeframe and theme through the change.' },
];

const TerrainPage = () => (
  <ProductPage
    name="Terrain"
    glyph="terrain"
    group="Market"
    head={['The chart page.', 'One to four charts on one set of controls.']}
    intro={
      <>
        Terrain is the chart page. One chart or four side by side, each with its own name, timeframe, overlays and theme, all run from one set of controls. The dealer book stands beside any chart as a strike rail,
        and the walls, the flip and the heaviest strike go on the candles with one switch. The drawing tools stay where you put them, your own Pine scripts draw on the pane, and any chart can be rewound and
        replayed a bar at a time.
      </>
    }
    path="/terrain"
    plan="It comes with Book."
  >
    {/* ── THE DESK ── */}
    <Aside eyebrow="The desk" first="Two charts, each with its book." second="Or one chart, or four." picture={<Picture src={`${SHOTS}/desk`} alt="Terrain's desk: two charts side by side, each with its strike rail beside it and its own strip over it, the desk bar at the foot" ratio="1440 / 1000" />}>
      <p>
        A pane is a chart with its own strip: the name, the price and the change, the timeframes, and the controls at the right. Press 1 to 4 on the bar at the foot and the desk lays that many out, each remembering
        its own name and timeframe. The sash between two panes is yours to drag, and a pane goes fullscreen from the door at the end of its strip, with the way back one key away.
      </p>
      <p>
        The strike rail stands beside any chart you want it on — the same book Pinpoint draws, pinned to the chart’s own price axis so a wall sits at the height it trades at. Colours are a choice for the whole desk:
        thermal, or the house’s own.
      </p>
    </Aside>

    {/* ── ONE SET OF CONTROLS ── */}
    <Room eyebrow="One set of controls" first="A strip over every chart." second="And one bar under all of them." pictures={<Pair cols={1} items={[
      { src: `${SHOTS}/strip`, ratio: '1400 / 63', name: 'A pane’s strip', says: 'The name and its price at the left, the timeframes after them, the fullscreen door at the end. The cluster — Replay, Indicators, Alerts, Candles, Overlays, Theme — rides the row when the pane is wide enough for it, and otherwise keeps a row of its own under the book that shows under the pointer. The strike rail’s own head stands beside it.' },
      { src: `${SHOTS}/bar`, ratio: '1400 / 44', name: 'The desk bar', says: 'How many charts, the Strikes switch for the rails, the Colours card, and Layouts: name an arrangement and bring it back with one pick. In fullscreen the bar floats, and gains the Pine door.' },
    ]} />}>
      <p>
        Every chart opens as the tape, the exposure trails and volume, with nothing named on it. The key levels are one switch away under Overlays, the indicators and scripts behind one door, and the chart’s theme
        is its own: change one pane and the others keep theirs.
      </p>
    </Room>

    {/* ── THE ONE RECORDING ── */}
    <Film />

    {/* ── THE STRIKE RAIL ── */}
    <Room eyebrow="The strike rail" first="The book beside the chart." second="Shown as a ladder or as the net." pictures={<Pair items={[
      { src: `${SHOTS}/rail-ladder`, ratio: '528 / 798', name: 'The ladder', says: 'A row a strike, the puts to the left and the calls to the right on the ramp, the figures past the tips, and the spine leaning the way the net leans with its ghost at the open. The walls, the flip and the heaviest strike are marked on the column.' },
      { src: `${SHOTS}/rail-net`, ratio: '528 / 798', name: 'The net', says: 'Each strike’s net gamma as a figure in the leading side’s ink, and under it one row of dashes split between puts and calls, the row’s length the strike’s weight against the heaviest on screen.' },
    ]} />}>
      <p>
        The rail reads the book at the chart’s own scale: a strike is at the height it trades at, so a wall on the rail is a wall on the candles. Its head carries an expiry calendar, so you can read the whole book or
        one date’s. Drag its edge to widen it, and drag the sash inside it to give the size lane more room than the flow lane. Bring the pointer onto a row and a card reads that strike in full.
      </p>
    </Room>

    {/* ── DRAWING TOOLS ── */}
    <Room eyebrow="Drawing tools" first="Thirty-four drawing tools." second="On a rail that stays the same size." pictures={<Pair items={[
      { src: `${SHOTS}/tools-family`, ratio: '653 / 545', name: 'A family’s list', says: 'One button per family — trend tools, Fibonacci, forecasting and measurement, geometric shapes, annotation — and the button wears the last tool you used from it. The chevron, a long press or a right click opens the family.' },
      { src: `${SHOTS}/tools-sheet`, ratio: '618 / 534', name: 'Every tool', says: 'The search opens every tool as one sheet: a box to type in, a tab a family, named tiles. A star on any tile keeps it under the rail’s own star, and Ctrl+K arms a tool by name on the chart the pointer was last over.' },
    ]} />}>
      <p>
        The rail is ten cells and stays ten cells. Positions, ranges, channels, the anchored VWAP, notes and callouts: each is drawn by its own gesture, snaps to the bars, and is kept with the chart, so it is there
        after a reload. Colour is white or your ink, except where a drawing is a direction: a position’s reward and risk, a range’s sign, the up and down stamps.
      </p>
    </Room>

    {/* ── YOUR OWN SCRIPTS ── */}
    <Room eyebrow="Your own scripts" first="Your own scripts, in Pine." second="Written beside the chart they draw on." pictures={<Pair items={[
      { src: `${SHOTS}/library`, ratio: '1200 / 822', name: 'The library', says: 'Behind the Indicators door: what you used recently, your favourites and your own scripts, then the shipped shelves — Slayer’s own, the technicals, the chart tools. A row’s switch puts it on the pane, the gear opens its inputs, and a name opens it in the editor.' },
      { src: `${SHOTS}/editor`, ratio: '1440 / 1000', name: 'The editor', says: 'Docked at the right of a fullscreen chart, as wide as you drag it. Every keystroke re-reads the script over the chart’s own bars and names the line of any error. Add to chart saves a version and draws it; a legend at the chart’s corner lists what is on, with an eye and an × for each.' },
    ]} />}>
      <p>
        Scripts run in your browser, over the bars you are looking at. The language is a Pine v6 subset with one addition: a Slayer namespace that hands a script the exposure, the walls and the flip, so an indicator can
        read the book, not just the price. A script’s alert conditions are switches, and when one trips it rings the same bell as every other alert.
      </p>
    </Room>

    {/* ── REPLAY ── */}
    <Aside eyebrow="Replay" first="Replay any chart." second="Rewind it and step it a bar at a time." flip picture={<Picture src={`${SHOTS}/replay`} alt="The replay card floating at the foot of a chart's price pane: the moment and the thin track above, the pace and the transport below" ratio="1400 / 442" />}>
      <p>
        Press Replay, pick a bar, and the chart is rewound to it. The card at the foot of the price pane carries the moment, a thin track with the day marks on it, and the transport: to the start, a step back,
        play, a step on, to the end. The pace is a multiple that says what it moves, one candle a second at 1× on a minute chart. It folds to a pill when you want the plot under it, and Back to live is one press.
      </p>
    </Aside>
  </ProductPage>
);

/** THE RECORDING: Terrain in use — the tour's own film, with three lines under it */
const Film = () => {
  const { a } = useGround();
  return (
    <div data-product-film="terrain">
      <div className="max-w-[72ch]">
        <Eyebrow>In use</Eyebrow>
        <Head className="mt-5" first="From two charts to one and back." second="You turn the rail and go to one chart and back." />
      </div>
      <TerminalWindow path="/terrain" theme={a} desk natural className="mt-8" />
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

export default TerrainPage;
