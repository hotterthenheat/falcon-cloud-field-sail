/*
==================================================
  SLAYER TERMINAL - A PRODUCT'S OWN PAGE
  (pages/landing/products/ProductPage.tsx)

  Noah, 2026-10-01 night: "make the products
  sections open up a new brief page explaining
  that product with recordings etc." And of the
  first one, Pulse (2026-10-02): "this section
  needs to start off with a slightly more detailed
  explanation throughout the page explaining what
  it does with images, i want only one screen
  recording on this page … these pages shouldn't
  be too long."

  So a product's page is the landing's clothes —
  the bar with its Products menu, the eyebrow and
  the two-tone head, the pills, the footer — around
  a short run of the product itself: the product's
  page in the window, still; a few sections that
  each say one thing about it beside a picture of
  that thing; ONE recording, of the one thing he
  named for it; and the door. Every picture is the
  real terminal (scripts/make-product-shots.mjs);
  the recording is the film maker's (`@<key>`).

  The page stands on the visitor's own ground, as
  the landing opens — one ground, no turn: it is a
  short page.
==================================================
*/

import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SiteFooter from '../../../components/layout/SiteFooter';
import { useLaunch } from '../../../components/layout/LaunchTransition';
import PageGlyph, { type GlyphName } from '../../../components/ui/PageGlyph';
import { Block, GroundProvider, useBlockGround, useGround } from '../ground';
import { Arrive, DOOR_ARROW, DOOR_GROUP, Eyebrow, Nav, Pill, TwoTone, Wrap, useDoorSeen } from '../pieces';
import TerminalWindow from '../TerminalWindow';

/** A SECTION'S HEAD: smaller than the page's, the same two tones */
export const Head = ({ first, second, className = '' }: { first: string; second: string; className?: string }) => (
  <h2 className={`arrive-line arrive-settle [--i:1] font-light tracking-[-0.035em] leading-[1.04] text-[32px] sm:text-[40px] lg:text-[46px] [text-wrap:balance] ${className}`}>
    {first} <span className="block text-textMuted">{second}</span>
  </h2>
);

/** A PICTURE OF THE PRODUCT, on the page's ground: `src` less its theme — the file is `<src>-<ground>.webp`. The frame is
    the window's, without its bar: a hairline, the panel's ground, the house's corner. */
export const Picture = ({ src, alt, ratio, className = '' }: { src: string; alt: string; ratio: string; className?: string }) => {
  const ground = useBlockGround();
  return (
    <figure className={`overflow-hidden rounded-[14px] border border-borderMuted bg-panel ${className}`} style={{ aspectRatio: ratio }} data-product-picture={src.split('/').pop()}>
      <img key={ground} src={`${src}-${ground}.webp`} alt={alt} draggable={false} loading="lazy" className="block w-full h-full object-cover object-left-top select-none animate-fade-in" />
    </figure>
  );
};

/** ONE THING ABOUT THE PRODUCT, said beside its picture. The words take five columns, the picture seven; `flip` puts the
    picture first. On a phone the words come first, then the picture. */
export const Aside = ({ eyebrow, first, second, flip = false, narrow = false, picture, children }: { eyebrow: string; first: string; second: string; flip?: boolean; /** a tall picture: five columns to it, seven to the words */ narrow?: boolean; picture: ReactNode; children: ReactNode }) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-12 gap-y-8 items-center" data-product-aside={eyebrow}>
    <Arrive className={`${narrow ? 'lg:col-span-7' : 'lg:col-span-5'} ${flip ? 'lg:order-2' : ''}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Head className="mt-5" first={first} second={second} />
      <div className={`arrive-line [--i:2] mt-6 flex flex-col gap-4 ${narrow ? 'max-w-[62ch]' : 'max-w-[52ch]'} text-[15.5px] leading-relaxed text-textSecondary`}>{children}</div>
    </Arrive>
    <div className={`${narrow ? 'lg:col-span-5' : 'lg:col-span-7'} ${flip ? 'lg:order-1' : ''}`}>{picture}</div>
  </div>
);

/** A TWO-UP OF PICTURES with a line under each — the pieces of a room */
export const Pair = ({ items, cols = 2 }: { items: { src: string; ratio: string; name: string; says: string }[]; /** three across for three pictures of one shape (Compass's card on its three tabs); one across for wide thin pictures that need the whole width to read (Terrain's strip and bar) */ cols?: 1 | 2 | 3 }) => (
  <ul className={`mt-10 grid grid-cols-1 ${cols === 3 ? 'md:grid-cols-3 gap-x-6' : cols === 2 ? 'lg:grid-cols-2 gap-x-8' : ''} gap-y-10`}>
    {items.map(a => (
      <li key={a.src} className="min-w-0" data-product-piece={a.src.split('/').pop()}>
        <Picture src={a.src} alt={a.name} ratio={a.ratio} />
        <p className="mt-4 text-[15px] font-medium text-textPrimary">{a.name}</p>
        <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-textSecondary">{a.says}</p>
      </li>
    ))}
  </ul>
);

/** A ROOM'S HEAD AND ITS PARAGRAPH, over whatever pictures follow */
export const Room = ({ eyebrow, first, second, children, pictures }: { eyebrow: string; first: string; second: string; children: ReactNode; pictures: ReactNode }) => (
  <div data-product-room={eyebrow}>
    <Arrive className="max-w-[72ch]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Head className="mt-5" first={first} second={second} />
      <div className="arrive-line [--i:2] mt-6 flex flex-col gap-4 max-w-[64ch] text-[15.5px] leading-relaxed text-textSecondary">{children}</div>
    </Arrive>
    {pictures}
  </div>
);

interface Props {
  /** the product, as the Products menu names it */
  name: string;
  glyph: GlyphName;
  /** the menu's group: Home, Market, The book, Trade, Practice */
  group: string;
  /** the head's two lines */
  head: [string, string];
  /** the paragraph under the head — the slightly longer explanation */
  intro: ReactNode;
  /** the terminal's page the product opens on — its still stands in the window at the top, and its door opens it */
  path: string;
  /** the plan it is on, as the closing line says it */
  plan: string;
  children: ReactNode;
}

const Page = ({ name, glyph, group, head, intro, path, plan, children }: Props) => {
  const { a } = useGround();
  const { launch } = useLaunch();
  const navigate = useNavigate();
  const doorSeen = useDoorSeen();
  /* a product's page opens at its head, wherever the landing was */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="relative isolate min-h-screen overflow-x-clip font-sans" data-product-page={name}>
      <Nav ground={a} door={!doorSeen} />
      {/* no padding under the block: the footer is the last thing in it and ends the page flush, as on the landing (Noah,
          2026-10-03: "its not all the way at the bottom unlike the one on the landing page") — the room before the
          footer is the door's own */}
      <Block on="a" id="product" label={name} className="pt-28 sm:pt-32">
        <Wrap>
          {/* ── THE HEAD: the product by name, what it is, and its page in the window ── */}
          <Arrive className="flex flex-col gap-5">
            <Eyebrow>
              Products <span className="text-textMuted/60">·</span> {group}
            </Eyebrow>
            <div className="arrive-line [--i:1] flex items-center gap-3" data-product-name>
              <PageGlyph name={glyph} size={28} />
              <span className="text-[22px] font-medium tracking-tight text-textPrimary">{name}</span>
            </div>
            <TwoTone first={head[0]} second={head[1]} />
            <div className="flex flex-col lg:flex-row lg:items-end gap-x-16 gap-y-6">
              <p className="arrive-line [--i:2] max-w-[64ch] text-[16px] sm:text-[17px] leading-relaxed text-textSecondary">{intro}</p>
              <div className="arrive-line [--i:3] lg:ml-auto shrink-0 lg:pb-1">
                <Pill href={path} onClick={() => launch(path)} testId="hero">
                  Open {name}
                </Pill>
              </div>
            </div>
          </Arrive>
          {/* the page in the window, still — a band, not the whole desk: the page is short, and the recording below shows the
              desk whole. The picture sits in it from its top left, the way a page sits in a window shorter than it. */}
          <TerminalWindow path={path} theme={a} desk film={false} className="mt-12 sm:mt-14 h-[420px] sm:h-[520px] lg:h-[620px]" />

          {/* ── THE PRODUCT, ONE THING AT A TIME ── */}
          <div className="mt-[12vh] flex flex-col gap-[11vh]">{children}</div>

          {/* ── THE DOOR ── */}
          <Arrive className="mt-[16vh] pt-[8vh] pb-[12vh] border-t border-borderSubtle text-center">
            <TwoTone first="Open it." second={plan} />
            <div className="arrive-line [--i:2] mt-10 flex flex-wrap justify-center items-center gap-x-5 gap-y-4">
              <Pill href={path} onClick={() => launch(path)} testId="close">
                Open {name}
              </Pill>
              <a
                href="/#everything"
                onClick={e => {
                  e.preventDefault();
                  navigate('/#everything');
                }}
                className={`${DOOR_GROUP} inline-flex items-center gap-1.5 h-12 px-2 text-[15px] text-textSecondary hover:text-textPrimary transition-colors`}
                data-product-every
              >
                Every page, by room
                <ArrowRight className={`w-4 h-4 ${DOOR_ARROW}`} aria-hidden="true" />
              </a>
            </div>
          </Arrive>
        </Wrap>
        <SiteFooter home={false} />
      </Block>
    </div>
  );
};

const ProductPage = (props: Props) => (
  <GroundProvider>
    <Page {...props} />
  </GroundProvider>
);

export default ProductPage;
