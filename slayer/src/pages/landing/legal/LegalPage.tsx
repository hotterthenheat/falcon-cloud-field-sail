/*
==================================================
  SLAYER TERMINAL - A LEGAL PAGE OF THE SITE
  (pages/landing/legal/LegalPage.tsx)

  Noah, 2026-10-05: "lets talk terms and service".
  The Terms and the Privacy Policy, in the landing's
  clothes — the bar, the eyebrow, the two-tone head,
  the footer — around a run of numbered sections.

  WRITTEN TO BE READ. Every section opens with one
  line IN PLAIN WORDS, then the text that governs.
  The words are ours from a blank page: our products
  by name, our rules (no refunds, no streaming, one
  person an account, arbitration one at a time), in
  the house voice. Nothing lifted from anyone else's
  terms, not even the section names.

  The two sections a reader must not miss — no
  promises about the service, what we are liable for
  — stand in a panel in the brighter ink, so they are
  conspicuous without shouting in capitals.

  LEGAL holds the few facts the pages share: the
  name, the address, the state. The state is empty
  until Noah names the company's home; the disputes
  section reads "the state where Slayer Terminal is
  based" until then, and one edit here fills it.
==================================================
*/

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SiteFooter from '../../../components/layout/SiteFooter';
import { Block, GroundProvider, useGround } from '../ground';
import { Arrive, DOOR_ARROW, DOOR_GROUP, Eyebrow, Nav, TwoTone, Wrap, useDoorSeen } from '../pieces';

/** The facts both pages share — the state is filled in once Noah names the company's home */
export const LEGAL = {
  name: 'Slayer Terminal',
  email: 'info@slayerterminal.com',
  site: 'slayerterminal.com',
  state: null as string | null,
};
/** "the State of Texas", or until it is named, "the state where Slayer Terminal is based" */
export const homeState = (): string => (LEGAL.state ? `the State of ${LEGAL.state}` : `the state where ${LEGAL.name} is based`);

export interface LegalSection {
  id: string;
  title: string;
  /** the section in one plain line — explains; the body governs */
  plain: string;
  body: ReactNode;
  /** the two a reader must not miss: a panel in the brighter ink */
  conspicuous?: true;
}

/** A paragraph of the body */
export const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
/** A list of the body — one point a line */
export const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="flex flex-col gap-2.5 pl-5 list-disc marker:text-textMuted">
    {items.map((it, i) => (
      <li key={i} className="pl-1">
        {it}
      </li>
    ))}
  </ul>
);
/** A lead-in word at the start of a point, in the brighter ink */
export const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-textPrimary">{children}</span>;
/** The address, as a mail door */
export const Mail = () => (
  <a href={`mailto:${LEGAL.email}`} className="text-textPrimary hover:underline underline-offset-2">
    {LEGAL.email}
  </a>
);
/** A door to the other legal page, or any page of the site */
export const To = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-textPrimary hover:underline underline-offset-2">
    {children}
  </Link>
);

interface Props {
  /** the page's id on the body, and the eyebrow's word */
  kind: 'Terms' | 'Privacy';
  title: string;
  /** "October 5, 2026" */
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
  /** the sibling page: its address and its name */
  sibling: { to: string; name: string };
}

const Page = ({ kind, title, updated, intro, sections, sibling }: Props) => {
  const { a } = useGround();
  const doorSeen = useDoorSeen();
  /* a legal page opens at its head, wherever the reader came from */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="relative isolate min-h-screen overflow-x-clip font-sans" data-legal-page={kind.toLowerCase()}>
      <Nav ground={a} door={!doorSeen} />
      <Block on="a" id="legal" label={title} className="pt-28 sm:pt-32">
        <Wrap>
          {/* THE PAGE ARRIVES (Noah, 2026-10-05: "make the transition to the privacy page and the terms of service page
              also have a nice simple smooth animation right now it is quick"): the head's lines rise one after another on
              the first paint, the way a section's head does when it scrolls into view; then the list of sections, then
              the first section. Every later section arrives as it is scrolled to. */}
          <Arrive atMount className="flex flex-col gap-5">
            <Eyebrow>
              Legal <span className="text-textMuted/60">·</span> {kind}
            </Eyebrow>
            <TwoTone first={`${title}.`} second={`Last updated ${updated}.`} />
            <div className="arrive-line [--i:2] max-w-[64ch] flex flex-col gap-4 text-[16px] sm:text-[17px] leading-relaxed text-textSecondary">{intro}</div>
          </Arrive>

          <div className="mt-14 sm:mt-16 grid grid-cols-1 lg:grid-cols-12 gap-x-16 gap-y-10">
            {/* THE SECTIONS BY NAME — a column that stays while the text scrolls; on a phone, the list above the text */}
            <Arrive atMount className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
              <nav className="arrive-line [--i:4]" aria-label="The sections">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-textMuted">In this page</p>
                <ol className="mt-3 flex flex-col gap-1.5 border-l border-borderSubtle">
                  {sections.map((s, i) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="-ml-px flex items-baseline gap-2.5 border-l border-transparent pl-3.5 py-0.5 text-[13px] leading-snug text-textSecondary hover:text-textPrimary hover:border-textPrimary/60 transition-colors">
                        <span className="font-mono text-[10px] tnum text-textMuted w-4 shrink-0">{i + 1}</span>
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </Arrive>

            {/* THE NUMBER HANGS IN THE MARGIN (Noah, 2026-10-05: the title "should be vertically aligned with its children
                making the number stick out of the alignment"): the number is a fixed box and the head is pulled left by
                exactly that box and its gap, so the title starts where the plain line and the body start. On a phone the
                column keeps that much room on its left so the number is not clipped at the gutter. */}
            <div className="lg:col-span-8 lg:col-start-5 flex flex-col gap-12 sm:gap-14 pl-9 lg:pl-0">
              {sections.map((s, i) => {
                /* the first section follows the head and the list on the first paint; the rest arrive as they are reached */
                const step = (n: number): CSSProperties => ({ '--i': i === 0 ? n + 5 : n } as CSSProperties);
                return (
                  <Arrive key={s.id} atMount={i === 0}>
                    <section id={s.id} className="scroll-mt-28" data-legal-section={s.id}>
                      <h2 className="arrive-line -ml-9 flex items-baseline gap-3 text-[21px] sm:text-[23px] font-medium tracking-tight text-textPrimary" style={step(0)}>
                        <span className="w-6 shrink-0 text-right font-mono text-[12px] tnum font-normal text-textMuted" aria-hidden="true">
                          {i + 1}
                        </span>
                        {s.title}
                      </h2>
                      {/* the line that explains, before the text that governs */}
                      <p className="arrive-line mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-textMuted" style={step(1)}>
                        In plain words
                      </p>
                      <p className="arrive-line mt-1.5 max-w-[60ch] text-[15.5px] leading-relaxed text-textPrimary" style={step(1)}>
                        {s.plain}
                      </p>
                      <div
                        className={`arrive-line mt-5 flex flex-col gap-4 max-w-[66ch] text-[15px] leading-relaxed ${
                          s.conspicuous ? 'rounded-[10px] border border-borderMuted bg-ink/[0.03] p-5 text-textPrimary' : 'text-textSecondary'
                        }`}
                        style={step(2)}
                      >
                        {s.body}
                      </div>
                    </section>
                  </Arrive>
                );
              })}
            </div>
          </div>

          {/* ── THE DOOR to the other page ── */}
          <Arrive className="mt-[14vh] pt-[8vh] pb-[12vh] border-t border-borderSubtle flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link to={sibling.to} className={`${DOOR_GROUP} inline-flex items-center gap-1.5 text-[15px] text-textPrimary`} data-legal-sibling>
              Read the {sibling.name}
              <ArrowRight className={`w-4 h-4 ${DOOR_ARROW}`} aria-hidden="true" />
            </Link>
            <Link to="/" className="text-[15px] text-textSecondary hover:text-textPrimary transition-colors">
              Front page
            </Link>
            <span className="text-[13px] text-textMuted">
              Questions about this page: <Mail />
            </span>
          </Arrive>
        </Wrap>
        <SiteFooter home={false} />
      </Block>
    </div>
  );
};

const LegalPage = (props: Props) => (
  <GroundProvider>
    <Page {...props} />
  </GroundProvider>
);

export default LegalPage;
