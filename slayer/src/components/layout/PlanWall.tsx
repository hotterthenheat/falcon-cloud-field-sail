/*
  What a locked room shows: its own picture dimmed behind glass with the room's glyph, name, line, the plan it is part
  of, and the Desk offer with its price and a door to checkout (the room's own lower plan as a quiet line). Signed
  out, it says sign in or choose. PlanGate sits between the shell's Outlet and the page and shows the wall when the
  held plan does not reach; while the account loads, the picture shows without words, never the real page.
  The server enforces the same plans on the data (shared/plans.mjs).
*/

import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { NAV_ITEMS, type NavItem } from './nav';
import PageGlyph from '../ui/PageGlyph';
import { stillFor } from '../../pages/landing/films';
import { useResolvedTheme } from '../../theme/theme';
import { planOf, priceOf, type PlanKey } from '../../data/billing';
import { planFor, useAccess } from '../../data/access';

/* the still's page: three rails lead to a section whose first page the photographer named (as the start page) */
const STILL_PATH: Record<string, string> = {
  '/trace': '/trace/live-tape',
  '/dossier': '/dossier/news',
  '/pinpoint': '/pinpoint/map',
};

/** what Desk holds, in one line — the tease */
const DESK_LINE = 'Compass, the Weigher, Practice and Community, with every room in Tape and Book.';

/** the rail's room for an address — the longest path it starts with */
const roomFor = (pathname: string): NavItem | null => {
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if (pathname !== item.path && !pathname.startsWith(`${item.path}/`)) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
};

/** The room's picture under the glass, with the words or bare while the account loads. `fill`: the wall covers the
    visible screen with the footer one scroll below; off, on a viewport-framed page, it fills the frame. */
const Ground = ({ room, fill = true, children }: { room: NavItem; fill?: boolean; children?: ReactNode }) => {
  const theme = useResolvedTheme();
  return (
    <div className={`relative rounded-md overflow-hidden ${fill ? 'min-h-[calc(100dvh-1.25rem)] max-md:min-h-[calc(100dvh-4.25rem)]' : 'flex-1 min-h-0'}`} data-plan-wall={room.path} data-plan-wall-state={children ? 'card' : 'asking'}>
      <img src={stillFor(STILL_PATH[room.path] ?? room.path, theme, 'desk')} alt="" aria-hidden draggable={false} className="absolute inset-0 w-full h-full object-cover object-left-top select-none" />
      <div aria-hidden className="absolute inset-0" style={{ background: 'var(--wall-scrim)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }} />
      {children && (
        <div className="absolute inset-0 flex items-center justify-center px-4 py-8 overflow-y-auto">
          {/* the pool behind the words, so they read clean while the page shows at the edges — the theme's --wall-pool */}
          <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1100px] h-[720px] pointer-events-none" style={{ background: 'var(--wall-pool)' }} />
          {children}
        </div>
      )}
    </div>
  );
};

const PlanWall = ({ room, needed, fill = true }: { room: NavItem; needed: PlanKey; fill?: boolean }) => {
  const theme = useResolvedTheme();
  const access = useAccess();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const signedOut = access.status === 'out';
  const holds = access.held ? planOf(access.held) : null;
  const need = planOf(needed);
  const desk = planOf('desk');
  const deskPrice = priceOf('desk', 'month');
  /* the room's own plan, when it is not Desk — a quiet second door */
  const own = needed !== 'desk' ? need : null;
  const ownPrice = own ? priceOf(needed, 'month') : null;
  const doorTo = (plan: PlanKey) => (signedOut ? `/signin?face=up&next=${encodeURIComponent(`/checkout?plan=${plan}&period=month`)}` : `/checkout?plan=${plan}&period=month`);
  const solid = `relative foil-glide ${theme === 'dark' ? 'holo-bg text-onfoil' : 'galaxy-bg'}`;
  return (
    /* no card: the words stand on the glass (as on the Community wall): the room's name in the foil, its line and plan,
       then the Desk offer in the landing's pricing type with one door; Tape quieter */
    <Ground room={room} fill={fill}>
      <div className="relative flex flex-col items-center text-center px-6 max-w-[620px] animate-soft-in-slow" data-plan-wall-card data-plan-needed={needed}>
        <p className="inline-flex items-center gap-1.5 font-mono text-t9 uppercase tracking-[0.3em] text-textMuted" data-plan-wall-tag>
          <Lock className="w-3 h-3" aria-hidden="true" />
          Part of {need.name}
        </p>
        {room.glyph && <PageGlyph name={room.glyph} size={40} className="mt-6" />}
        {/* pb-2: the holo fill paints only inside the box, and a descender at leading-none fell outside it (the Community wall's lesson) */}
        <h2 className="mt-3 pb-2 text-t56 font-bold tracking-tight leading-none holo-text paper-galaxy" data-plan-wall-title>
          {room.label}
        </h2>
        <p className="mt-3 max-w-md text-t14 leading-relaxed text-textSecondary">{room.description}</p>
        <p className="mt-3 text-t13 leading-relaxed text-textPrimary" data-plan-wall-line>
          {signedOut ? `Sign in, or choose a plan, and it opens.` : holds ? `You are on ${holds.name}.` : `A plan opens it.`}
        </p>

        {/* DESK FIRST — every wall sells the whole desk, in the pricing cards' own type */}
        <div className="mt-10 flex flex-col items-center" data-plan-wall-desk>
          <p className="font-mono text-t9 uppercase tracking-[0.3em] text-textMuted">{desk.name} · all of it</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-t44 font-light leading-none tracking-[-0.045em] tnum text-textPrimary">{deskPrice.price}</span>
            <span className="font-mono text-t11 text-textMuted">{deskPrice.period}</span>
          </p>
          <p className="mt-2.5 max-w-sm text-t13 leading-relaxed text-textSecondary">{DESK_LINE}</p>
          <Link to={doorTo('desk')} className={`mt-6 h-12 pl-7 pr-6 rounded-full inline-flex items-center justify-center gap-2 text-t15 font-medium ${solid}`} data-plan-wall-go="desk">
            {holds ? 'Upgrade to Desk' : 'Choose Desk'}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        {own && ownPrice && (
          <p className="mt-6 text-t125 leading-relaxed text-textSecondary" data-plan-wall-own={needed}>
            Or just {own.name}, {ownPrice.price} {ownPrice.period}:{' '}
            <Link to={doorTo(needed)} className="text-textPrimary hover:underline underline-offset-2" data-plan-wall-go={needed}>
              {holds ? `upgrade to ${own.name}` : `choose ${own.name}`}
            </Link>
            .
          </p>
        )}
        {signedOut && (
          <p className="mt-2 text-t125 leading-relaxed text-textSecondary">
            Already on a plan?{' '}
            <Link to={`/signin?next=${encodeURIComponent(here)}`} className="text-textPrimary hover:underline underline-offset-2" data-plan-wall-signin>
              Sign in
            </Link>
            .
          </p>
        )}
        {/* an owner looking through a plan's eyes is told so, and where the switch is */}
        {access.owner && access.viewing !== 'self' && (
          <p className="mt-8 font-mono text-t10 text-textMuted" data-plan-wall-viewing={access.viewing}>
            You are an owner seeing the terminal as {access.viewing === 'none' ? 'no plan' : planOf(access.viewing).name}.{' '}
            <Link to="/settings/billing" className="text-textSecondary hover:text-textPrimary hover:underline underline-offset-2">
              Settings › Billing
            </Link>{' '}
            switches it back.
          </p>
        )}
      </div>
    </Ground>
  );
};

/** between the shell's Outlet and the page; `fill` off on a page framed to the viewport */
export const PlanGate = ({ children, fill = true }: { children: ReactNode; fill?: boolean }) => {
  const location = useLocation();
  const access = useAccess();
  if (!access.on) return <>{children}</>;
  const needed = planFor(location.pathname);
  if (!needed) return <>{children}</>;
  const room = roomFor(location.pathname);
  if (!room) return <>{children}</>;
  if (access.status === 'loading') return <Ground room={room} fill={fill} />;
  if (access.can(needed)) return <>{children}</>;
  return <PlanWall room={room} needed={needed} fill={fill} />;
};

