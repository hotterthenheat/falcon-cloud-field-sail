/* The start page: every rail page as a card (its still in both themes, glyph, name, one line), each a door. The landing's launch door
   lands here unless Settings › The desk › Opens on names another page. */

import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SlayerMark from '../../brand/SlayerMark';
import { NAV_ITEMS } from '../../components/layout/nav';
import PageGlyph from '../../components/ui/PageGlyph';
import { Lock } from 'lucide-react';
import { settleAfterPurchase, useAccount } from '../../data/account';
import { planFor, useAccess } from '../../data/access';
import { planOf } from '../../data/billing';
import { useResolvedTheme } from '../../theme/theme';
import { stillFor } from '../landing/films';
import { START_GRID, START_PICTURE } from './startSkeleton';

/* The still's page: three rails lead to a section whose first page was photographed. */
const STILL_PATH: Record<string, string> = {
  '/trace': '/trace/live-tape',
  '/dossier': '/dossier/news',
  '/pinpoint': '/pinpoint/map',
};

/* ONE LINE A PAGE, in plain words — the rail's tooltips and the landing's lines, said shorter. A rail page without a
   line here (Community, behind its wall; Settings) has no card. */
const LINES: Record<string, string> = {
  '/pulse': 'The live desk. Tiles you add, drag and size, each holding one thing and one read, on a desk that saves as you go.',
  '/terrain': 'Charts and nothing in the way. One to four side by side, on one set of controls, the book beside any of them.',
  '/trace': 'The options tape and the dark pool, print by print: who is buying what, and where the money is leaning.',
  '/dossier': 'The file on a name: its news, who reports when, what insiders filed, what Congress disclosed, how it screens.',
  '/pinpoint': 'The dealer book as a matrix or a calendar: the walls, the flip, and what they mean for the day ahead.',
  '/compass': 'Contracts scored on the terminal’s live quotes, same day and one to seven days out, each call with its marks on the chart.',
  '/weigher': 'One desk for a contract: the chain, the book at a strike, your positions and your watchlist.',
  '/practice/paper': 'Trade today’s live option quotes with pretend money on a practice account.',
  '/practice/backtest': 'Replay a recorded ThetaData session minute by minute and trade it at the bid and ask each contract had.',
  '/practice/journal': 'Every trade you closed, paper, backtest or your own journal, on its day, with your own words on it.',
};

const CARDS = NAV_ITEMS.filter(item => item.glyph && LINES[item.path]);

const Start = () => {
  const theme = useResolvedTheme();
  const account = useAccount();
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  /* Paid and landed here: the plan is named in the head's line, the row re-read until Stripe's word lands; the address mark goes once the plan shows. */
  const paid = params.get('checkout') === 'success';
  const plan = account.profile && account.profile.plan !== 'none' && ['active', 'trialing', 'past_due'].includes(account.profile.planStatus) ? planOf(account.profile.plan) : null;
  useEffect(() => {
    if (paid) settleAfterPurchase();
  }, [paid]);
  useEffect(() => {
    if (paid && plan) setParams({}, { replace: true });
  }, [paid, plan, setParams]);
  return (
    <div className="flex flex-col gap-5" data-start-page>
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle shrink-0" aria-hidden="true">
              <SlayerMark size={13} bare label="" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">Start</h1>
            <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">· where to begin</span>
          </div>
          <p className="mt-0.5 text-t11 text-textMuted" data-start-line={paid ? 'paid' : undefined}>
            {paid
              ? plan
                ? `Thank you — ${plan.name} is yours. Every page of the terminal, one picture and one line each: pick where to begin.`
                : 'Thank you. Stripe is confirming the payment; your plan lands in a moment. Every page of the terminal, one picture and one line each: pick where to begin.'
              : 'Every page of the terminal, one picture and one line each. Pick one; the rest stay one press away on the rail, or the menu on a phone.'}
          </p>
        </div>
      </header>

      <ul className={START_GRID} data-start-cards>
        {CARDS.map((card, i) => (
          <li key={card.path} className="min-w-0">
            <Link
              to={card.path}
              title={`Open ${card.label}`}
              className="group block h-full rounded-lg border border-borderSubtle bg-panel overflow-hidden transition-colors hover:border-borderMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-silver/60"
              data-start-card={card.path}
            >
              {/* THE PICTURE: the real page, in the theme the reader is on; the first row comes with the page, the rest as
                  they scroll into view */}
              <div className={START_PICTURE}>
                <img
                  key={theme}
                  src={stillFor(STILL_PATH[card.path] ?? card.path, theme, 'desk')}
                  alt={`${card.label}, as it looks`}
                  draggable={false}
                  loading={i < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover object-left-top select-none"
                />
              </div>
              <div className="px-3.5 pt-3 pb-3.5 border-t border-borderSubtle/60">
                <p className="flex items-center font-mono text-t9 uppercase tracking-widest text-textMuted">
                  {card.group}
                  {/* A room outside the held plan says which plan it is part of; the card still opens, onto the wall. */}
                  {access.on && !access.can(card.path) && (
                    <span className="ml-auto inline-flex items-center gap-1" data-start-locked={planFor(card.path) ?? ''}>
                      <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                      {planOf(planFor(card.path) ?? 'desk').name}
                    </span>
                  )}
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-t14 font-semibold leading-tight text-textPrimary">
                  <PageGlyph name={card.glyph!} size={17} className="shrink-0" />
                  {card.label}
                  <ArrowRight className="ml-auto w-3.5 h-3.5 shrink-0 text-textMuted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-textPrimary" aria-hidden="true" />
                </p>
                <p className="mt-1.5 text-t125 leading-snug text-textSecondary">{LINES[card.path]}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-t11 text-textMuted" data-start-foot>
        Community opens after launch. Where the terminal opens next time is yours to set in{' '}
        <Link to="/settings/desk" className="text-textSecondary hover:text-textPrimary transition-colors underline-offset-2 hover:underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
};

export default Start;
