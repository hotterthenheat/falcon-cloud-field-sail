/* Which scene a page's footer shows, by address. The scenes (scenes.ts and parts/) are one chunk, fetched the first
   time a footer draws, so no page carries them in its first load. */

import type { SceneMaker } from './kit';

export type SceneName =
  | 'landing'
  | 'pulse'
  | 'terrain'
  | 'trace'
  | 'dossier'
  | 'pinpoint'
  | 'compass'
  | 'weigher'
  | 'paper'
  | 'backtest'
  | 'journal'
  | 'alerts'
  | 'settings'
  | 'room'
  | 'status'
  | 'about'
  | 'legal'
  | 'account'
  | 'invite'
  | 'maintenance';

/* Scenes mapped to our routes (App.tsx): a product page (/products/*) shows its room's scene; /terms, /privacy and
   /signin have their own. The status, about, invite and maintenance scenes have no page yet. */
const BY_PATH: [RegExp, SceneName][] = [
  [/^\/(products\/)?pulse/, 'pulse'],
  [/^\/(products\/)?terrain/, 'terrain'],
  [/^\/(products\/)?trace/, 'trace'],
  [/^\/(products\/)?(dossier|record)/, 'dossier'],
  [/^\/(products\/)?pinpoint/, 'pinpoint'],
  [/^\/(products\/)?compass/, 'compass'],
  [/^\/(products\/)?weigher/, 'weigher'],
  [/^\/(products\/|practice\/)backtest/, 'backtest'],
  [/^\/(products\/|practice\/)journal/, 'journal'],
  [/^\/(products\/)?(practice|paper)/, 'paper'],
  [/^\/(products\/)?alerts/, 'alerts'],
  [/^\/settings/, 'settings'],
  [/^\/community/, 'room'],
  [/^\/status/, 'status'],
  [/^\/about/, 'about'],
  [/^\/(legal|terms|privacy)/, 'legal'],
  [/^\/(signup|signin|reset|verified|expired)/, 'account'],
  [/^\/(i\/|welcome)/, 'invite'],
  [/^\/maintenance/, 'maintenance'],
];

export const sceneFor = (pathname: string): SceneName => BY_PATH.find(([re]) => re.test(pathname))?.[1] ?? 'pulse';

let chunk: Promise<Record<SceneName, SceneMaker>> | null = null;
/** the scene's maker, once the scenes' chunk is in (asked for again after a failed fetch) */
export const loadScene = (name: SceneName): Promise<SceneMaker> => {
  chunk ??= import('./scenes').then(
    m => m.SCENES,
    e => {
      chunk = null;
      throw e;
    },
  );
  return chunk.then(s => s[name]);
};
