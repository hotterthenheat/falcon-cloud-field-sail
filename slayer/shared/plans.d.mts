export type PlanKey = 'book' | 'tape' | 'desk' | 'seat';
export type ViewAs = 'self' | 'none' | PlanKey;

export interface PlanProfile {
  role: string;
  plan: string;
  planStatus: string;
  grantPlan: string | null;
  grantUntil: string | null;
}

export const PLAN_RANK: Record<PlanKey, number>;
export const ROOM_PLAN: [string, PlanKey][];
export const FEED_PLAN: { uw: PlanKey; theta: PlanKey };
export function isPlan(v: unknown): v is PlanKey;
export function planFor(pathname: string): PlanKey | null;
export function grantHeld(p: PlanProfile | null, now?: number): PlanKey | null;
export function planHeld(p: PlanProfile | null, view?: ViewAs, now?: number): PlanKey | null;
export function opens(held: PlanKey | null, needed: PlanKey | null): boolean;
