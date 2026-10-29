/* The Terms and Privacy pages in the landing's clothes: numbered sections, each opening with one plain line, then the governing text.
   The two must-read sections stand in a brighter panel. LEGAL holds the shared facts; the state is blank until set. */

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SiteFooter from '../../../components/layout/SiteFooter';
import { Block, GroundProvider, useGround } from '../ground';
import { Arrive, DOOR_ARROW, DOOR_GROUP, Eyebrow, Nav, TwoTone, Wrap, useDoorSeen } from '../pieces';

/** The facts both pages share; `state` is filled in once the company's home state is set. */
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
          {/* The page arrives: the head's lines rise in turn on first paint, then the section list and the first section; the rest arrive as scrolled to. */}
          <Arrive atMount className="flex flex-col gap-5">
            <Eyebrow>
              Legal <span className="text-textMuted/60">·</span> {kind}
            </Eyebrow>
            <TwoTone first={`${title}.`} second={`Last updated ${updated}.`} />
            <div className="arrive-line [--i:2] max-w-[64ch] flex flex-col gap-4 text-t16 sm:text-t17 leading-relaxed text-textSecondary">{intro}</div>
          </Arrive>

          <div className="mt-14 sm:mt-16 grid grid-cols-1 lg:grid-cols-12 gap-x-16 gap-y-10">
            {/* The sections by name: a sticky column on desk, the list above the text on a phone. */}
            <Arrive atMount className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
              <nav className="arrive-line [--i:4]" aria-label="The sections">
                <p className="font-mono text-t10 uppercase tracking-[0.2em] text-textMuted">In this page</p>
                <ol className="mt-3 flex flex-col gap-1.5 border-l border-borderSubtle">
                  {sections.map((s, i) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="-ml-px flex items-baseline gap-2.5 border-l border-transparent pl-3.5 py-0.5 text-t13 leading-snug text-textSecondary hover:text-textPrimary hover:border-textPrimary/60 transition-colors">
                        <span className="font-mono text-t10 tnum text-textMuted w-4 shrink-0">{i + 1}</span>
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </Arrive>

            {/* The number hangs in the margin: the head is pulled left by the number's box and gap so titles align with their body;
   a phone keeps that room on the left. */}
            <div className="lg:col-span-8 lg:col-start-5 flex flex-col gap-12 sm:gap-14 pl-9 lg:pl-0">
              {sections.map((s, i) => {
                /* the first section follows the head and the list on the first paint; the rest arrive as they are reached */
                const step = (n: number): CSSProperties => ({ '--i': i === 0 ? n + 5 : n } as CSSProperties);
                return (
                  <Arrive key={s.id} atMount={i === 0}>
                    <section id={s.id} className="scroll-mt-28" data-legal-section={s.id}>
                      <h2 className="arrive-line -ml-9 flex items-baseline gap-3 text-t21 sm:text-t23 font-medium tracking-tight text-textPrimary" style={step(0)}>
                        <span className="w-6 shrink-0 text-right font-mono text-t12 tnum font-normal text-textMuted" aria-hidden="true">
                          {i + 1}
                        </span>
                        {s.title}
                      </h2>
                      {/* the line that explains, before the text that governs */}
                      <p className="arrive-line mt-3 font-mono text-t10 uppercase tracking-[0.2em] text-textMuted" style={step(1)}>
                        In plain words
                      </p>
                      <p className="arrive-line mt-1.5 max-w-[60ch] text-t155 leading-relaxed text-textPrimary" style={step(1)}>
                        {s.plain}
                      </p>
                      <div
                        className={`arrive-line mt-5 flex flex-col gap-4 max-w-[66ch] text-t15 leading-relaxed ${
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
            <Link to={sibling.to} className={`${DOOR_GROUP} inline-flex items-center gap-1.5 text-t15 text-textPrimary`} data-legal-sibling>
              Read the {sibling.name}
              <ArrowRight className={`w-4 h-4 ${DOOR_ARROW}`} aria-hidden="true" />
            </Link>
            <Link to="/" className="text-t15 text-textSecondary hover:text-textPrimary transition-colors">
              Front page
            </Link>
            <span className="text-t13 text-textMuted">
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
