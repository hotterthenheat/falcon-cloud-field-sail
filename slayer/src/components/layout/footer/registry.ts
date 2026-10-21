/*
  WHICH PICTURE A PAGE'S FOOTER SHOWS (components/layout/footer/registry.ts) — 2026-10-03, the owner: "each page had its
  own art work similar to that one but thats representive of its page … and then the landing page one you go into more
  depth". The address picks the scene; the scenes themselves (scenes.ts and its parts) are one chunk of their own, fetched
  the first time a footer is drawn, so no page carries them in its first load.
*/

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

/* THE PICTURES ARE HIS, THE ADDRESSES OURS (2026-10-07 — Noah: "for the footers my partner actually wants the other ones
   and not the actual look of the website"): the scenes came over whole from his repo; this list maps them to OUR routes
   (App.tsx). A product's own page of the site (/products/*) shows its room's picture; the legal pages are /terms and
   /privacy; the account's page is /signin. His status, about, invite and maintenance pictures wait for pages of ours. */
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
