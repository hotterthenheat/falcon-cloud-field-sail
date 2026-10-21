/*
==================================================
  SLAYER TERMINAL - THE DOSSIER, ON ITS OWN PAGE
  (pages/landing/products/DossierPage.tsx)

  The second product page (Noah, 2026-10-02): "next
  is the dossier page, make sure the stocks full
  analysis sections, on the news page everything of
  importance from the headlines high, medium and low
  to the calendar and anything else you deem
  important. remember that the key behind all of
  these pages is that your english doesn't sound
  like a robot … articulate yourself like how a
  20-30 year old professional would."

  Five rooms, one page: THE WIRE (the story beside
  the map, the headlines with their impact marks,
  the one recording — the tour's own film of the
  page — and the calendar with the four reads),
  EARNINGS (the week, a name's last eight prints),
  STOCKS (how every name screens, then four sections
  of a name's full analysis), INSIDERS and CONGRESS
  side by side. Every picture is the real page
  (scripts/make-product-shots.mjs, `dossier`).
==================================================
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Picture } from './ProductPage';

const SHOTS = '/landing/products/dossier';

/** the recording's three lines — what the tour's film of the wire shows, in order */
const WIRE_FILM: { word: string; says: string }[] = [
  { word: 'The story', says: 'Open a story and it unfolds beside the map, first paragraph in the open, the rest a press away, with the source linked at the end.' },
  { word: 'The map', says: 'Every headline is a pin on the city it came from. Pick one and the map draws in on its place; the arcs are the markets it reaches.' },
  { word: 'The day', says: 'Scroll down and the calendar is waiting: press a date and the panel beside it lists what is on it, with the time.' },
];

/** the four sections of a name's full analysis that the page shows up close */
const ANALYSIS: { file: string; ratio: string; name: string; says: string }[] = [
  { file: 'stock-name', ratio: '1800 / 239', name: 'The name', says: 'Price and the day, the market’s phase, the screen and the lean in words, and the four pillars as bars with their figures on them.' },
  { file: 'stock-why', ratio: '1800 / 348', name: 'Why now', says: 'The biggest facts on the name right now, what is for it and what is against it, whether the four pillars agree, and the main risk if they don’t.' },
  { file: 'stock-trend-money', ratio: '1800 / 968', name: 'The trend and the money', says: 'The averages, RSI and ADX, the structure’s flags; then the book on a price scale with the walls, the flip and spot, calls against puts, and which way the dark pool leans.' },
  { file: 'stock-behind', ratio: '1800 / 819', name: 'Behind the read', says: 'Every factor in points, what carries the score and what drags it, the weights, how the trend read session by session, and the moves that would change the read. The method sits behind a fold.' },
];

const DossierPage = () => (
  <ProductPage
    name="Dossier"
    glyph="dossier"
    group="Market"
    head={['Everything on the record for a name.', 'News, earnings, insiders, Congress.']}
    intro={
      <>
        Dossier is where you check what has actually been said about a name before you trade it. Five pages: the news wire with the numbers behind each headline, the earnings calendar with how every name has moved on its last
        eight prints, what insiders did with their own shares, what members of Congress reported, and a screen that scores every name on its trend, its numbers, the money and the news. Each page opens on the whole market and
        narrows to one name in a click.
      </>
    }
    path="/dossier/news"
    plan="It comes with Tape."
  >
    {/* ── THE WIRE: the story beside the map ── */}
    <Aside
      eyebrow="The wire"
      first="The whole story."
      second="The headline, the body and the numbers."
      narrow
      flip
      picture={<Picture src={`${SHOTS}/story`} alt="A story open beside the map: its lean, its expected move, what is priced in, the odds, the playbook and what would kill the read" ratio="832 / 1060" />}
    >
      <p>
        Every story on the wire lands on a map: a pin on the city it came from, arcs out to the markets it reaches. Pick one and it opens beside the map with the part that matters. How it reads for the name — positive,
        negative or neutral. The move expected over one day and over five. How much of that move the tape has already priced in, how many sessions the story keeps working, and whether the options book backs it or leans
        the other way.
      </p>
      <p>
        Under that, the odds for the next session as a bar, a playbook in two lines, what stories like it have done before, and what would kill the read. Two doors at the foot put the name on the map or on the chart.
      </p>
    </Aside>

    {/* ── THE HEADLINES, BY WEIGHT ── */}
    <Aside
      eyebrow="The headlines"
      first="Every headline is weighed."
      second="High, medium or low, before you read it."
      picture={<Picture src={`${SHOTS}/headlines`} alt="The wire's rows: time, name, kind, the read, the headline with its impact mark, the one-day move and how sure the read is" ratio="1800 / 553" />}
    >
      <p>
        Every headline carries an impact mark. Red is high: it moves the market on its own — a print, a rate decision, a big earnings miss. Amber is medium: it moves a name, a sector or a currency. Grey is low: noted, and
        usually that’s all it is.
      </p>
      <p>
        The row carries the rest: the kind of story, which way it reads, the expected one-day move and how sure the read is, in one of four words. You can skim forty headlines and stop on the three that matter to you.
      </p>
    </Aside>

    {/* ── THE ONE RECORDING ── */}
    <WireFilm />

    {/* ── THE DAY ── */}
    <Aside
      eyebrow="The day"
      first="What is ahead, by date."
      second="With a short summary of the wire."
      flip
      picture={<Picture src={`${SHOTS}/calendar`} alt="The month's calendar of prints and reports, a day open beside it, and the four reads under it" ratio="1800 / 1030" />}
    >
      <p>
        The calendar at the foot of the wire holds the prints and the reports ahead, by date, each marked the same way: red for the ones that move the market, amber for the ones that move a name. Keep it to data, to earnings,
        or everything. Press a date and the panel beside the month lists what is on it, with the time.
      </p>
      <p>Under it, four lines say what the day adds up to: today’s lean, the biggest story type, the macro backdrop, and what just landed.</p>
    </Aside>

    {/* ── EARNINGS ── */}
    <div data-product-earnings>
      <Aside
        eyebrow="Earnings"
        first="Who reports this week."
        second="What is priced in, against the usual move."
        picture={<Picture src={`${SHOTS}/earnings-week`} alt="The earnings page: the week day by day, then every report with its priced move against its usual one" ratio="1440 / 1000" />}
      >
        <p>
          Earnings opens on the week: who reports each day, before the open or after the close, what the options market has priced for the move against what the name usually does on its prints, and whether that looks rich,
          fair or cheap.
        </p>
        <p>
          Open a name and you get its last eight prints. Today’s price replayed against the move each one made, beats and misses against the estimate, the move the session after the print, how fast the implied vol came out
          overnight, and the busiest calls and puts going in.
        </p>
      </Aside>
      <Picture src={`${SHOTS}/earnings-name`} alt="A name's earnings page: today's price replayed against the last eight prints, beats and misses, and the past moves" ratio="1800 / 811" className="mt-8" />
    </div>

    {/* ── STOCKS: the screen, then the full analysis ── */}
    <div data-product-stocks>
      <Aside
        eyebrow="Stocks"
        first="Every name on one screen."
        second="Read four ways, each in one word."
        flip
        picture={<Picture src={`${SHOTS}/stocks`} alt="The stocks page: the rotation by sector, then every name with its four sleeves and its screen" ratio="1440 / 1000" />}
      >
        <p>
          Stocks scores every name on four sleeves — the trend, the numbers, the money and the news — and rolls them into one screen: strong, good, caution or poor. The same sleeves rolled up by sector are the rotation, so who
          is leading and which names carry it come out of one calculation, never two opinions.
        </p>
        <p>The grid shows each name with its sector, the day, a 30-day line, the four sleeves as bars and the screen. Keep it to one screen, one sector or a few names, and it reads the same way.</p>
      </Aside>

      <div className="mt-[10vh]">
        <div className="max-w-[62ch]">
          <Eyebrow>The full analysis</Eyebrow>
          <Head className="mt-5" first="A name’s own page." second="Open a name and its page comes up." />
          <p className="mt-6 text-[15.5px] leading-relaxed text-textSecondary">
            Everything the screen knows about a name, laid out top to bottom. Four of its sections are below. The same page also carries the wire on the name and its next report, a timeline of the sessions on hand, the
            tape’s biggest buys and sells and busiest contracts — each a door to the Weigher — and what its insiders and Congress did.
          </p>
        </div>
        <ul className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-10">
          {ANALYSIS.map(a => (
            <li key={a.file} className="min-w-0" data-product-analysis={a.file}>
              <Picture src={`${SHOTS}/${a.file}`} alt={`${a.name} — a section of a name's page`} ratio={a.ratio} />
              <p className="mt-4 text-[15px] font-medium text-textPrimary">{a.name}</p>
              <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-textSecondary">{a.says}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>

    {/* ── INSIDERS AND CONGRESS ── */}
    <div data-product-record>
      <div className="max-w-[62ch]">
        <Eyebrow>Insiders and Congress</Eyebrow>
        <Head className="mt-5" first="Insiders and Congress." second="Who bought, and who had to report it." />
      </div>
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-12">
        <div>
          <Picture src={`${SHOTS}/insiders`} alt="The insiders page: the names to know, then every filing" ratio="1440 / 1000" />
          <p className="mt-5 max-w-[56ch] text-[15px] leading-relaxed text-textSecondary">
            <span className="text-textPrimary">Insiders</span> is what the people running a company did with their own shares — open-market trades by default — and whether they chose to. A sale that ran off a 10b5-1 plan
            adopted months ago says nothing about today, and the page marks it as such. The names to know are the ones where someone paid their own money to buy, heaviest first.
          </p>
        </div>
        <div>
          <Picture src={`${SHOTS}/congress`} alt="The Congress page: the reports to know, then every report" ratio="1440 / 1000" />
          <p className="mt-5 max-w-[56ch] text-[15px] leading-relaxed text-textSecondary">
            <span className="text-textPrimary">Congress</span> is what members reported trading under the STOCK Act, and how long they took to file it. The reports worth your time are trades in a sector the member’s own
            committee oversees; those sort to the top, biggest bracket first.
          </p>
        </div>
      </div>
    </div>
  </ProductPage>
);

/** THE RECORDING: the wire in use — the tour's own film of the page, with three lines under it */
const WireFilm = () => {
  const { a } = useGround();
  return (
    <div data-product-film="dossier-news">
      <div className="max-w-[72ch]">
        <Eyebrow>In use</Eyebrow>
        <Head className="mt-5" first="A story, the map, and a date." second="You open a story, move the map and press a date." />
      </div>
      <TerminalWindow path="/dossier/news" theme={a} desk natural className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {WIRE_FILM.map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DossierPage;
