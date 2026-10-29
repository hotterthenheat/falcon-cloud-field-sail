/*
  The plan gates in the browser. Which plan opens which room lives in shared/plans.mjs, which the data proxies
  (server/) also enforce; this file only hides what the server would refuse anyway.
  With no Stripe key in the environment there are no gates, so a machine without keys keeps working.
*/

import { useMemo, useSyncExternalStore } from 'react';
import { useAccount, type AccountState } from './account';
import { BILLING_ON, type PlanKey } from './billing';
import { PLAN_RANK, grantHeld, opens, planFor, planHeld, type ViewAs } from '../../shared/plans.mjs';

export { PLAN_RANK, grantHeld, opens, planFor, planHeld, type ViewAs };

/* Automated browsers (navigator.webdriver) walk a signed-out dev server; a production build never reads this. */
export const GATES_ON: boolean = BILLING_ON && !(import.meta.env?.DEV && typeof navigator !== 'undefined' && navigator.webdriver);

/* An owner may look through a plan's eyes for this browser session; only what the gates open changes. */
const VIEW_KEY = 'slayer_view_as';
const readView = (): ViewAs => {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    return v === 'none' || v === 'book' || v === 'tape' || v === 'desk' ? v : 'self';
  } catch {
    return 'self';
  }
};
let viewAs: ViewAs = typeof window !== 'undefined' ? readView() : 'self';
const viewListeners = new Set<() => void>();
export const getViewAs = (): ViewAs => viewAs;
export function setViewAs(v: ViewAs): void {
  viewAs = v;
  try {
    if (v === 'self') sessionStorage.removeItem(VIEW_KEY);
    else sessionStorage.setItem(VIEW_KEY, v);
  } catch {
    /* storage off: the view lives for the page */
  }
  viewListeners.forEach(fn => fn());
}
const subscribeView = (fn: () => void) => {
  viewListeners.add(fn);
  return () => {
    viewListeners.delete(fn);
  };
};
export const useViewAs = (): ViewAs => useSyncExternalStore(subscribeView, getViewAs, getViewAs);

export interface Access {
  /** gates exist on this build */
  on: boolean;
  status: AccountState['status'];
  /** the plan held, standing: 'seat' for an owner, null for none */
  held: PlanKey | null;
  owner: boolean;
  /** an owner or the team: the People room and the log open */
  team: boolean;
  /** walks through the coming-soon wall: an owner, or a beta grant */
  beta: boolean;
  /** an owner looking through a plan's eyes; 'self' otherwise */
  viewing: ViewAs;
  /** a room's path, or a plan by name: does the person get in? */
  can: (pathOrPlan: string) => boolean;
}

export function useAccess(): Access {
  const a = useAccount();
  const view = useViewAs();
  const role = a.profile?.role ?? null;
  const viewing: ViewAs = role === 'owner' ? view : 'self';
  const held: PlanKey | null = GATES_ON ? planHeld(a.profile, viewing) : 'seat';
  return useMemo(
    () => ({
      on: GATES_ON,
      status: a.status,
      held,
      owner: role === 'owner',
      team: role === 'owner' || role === 'team',
      beta: role === 'owner' || !!a.profile?.beta,
      viewing,
      can: (x: string) => !GATES_ON || opens(held, x.startsWith('/') ? planFor(x) : (x as PlanKey)),
    }),
    [a.status, held, role, viewing, a.profile?.beta]
  );
}
