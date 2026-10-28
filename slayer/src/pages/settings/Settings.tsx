/*
==================================================
  SLAYER TERMINAL - SETTINGS (pages/settings/Settings.tsx)

  How the terminal looks, what the desk opens on,
  what it says out loud (Noah, 2026-09-12: "creating
  the skeleton for the settings page and
  incorporating just the theme light and dark
  mode"). The shape he took from the mockup: the
  shell head wearing the house mark, a rail of
  sections at the left, and each setting as a ROW —
  the name and one line at the left, the control at
  the right, hairlines between — the way Linear
  lays its preferences. No cards for facts.

  ONE RULE: a control exists only when it does
  something today. Account, billing and the data
  provider are rows that say they arrive with the
  launch, never a switch that does nothing.

  THE THEME TILES draw the terminal itself in each
  theme — the tokens are scoped by `data-theme` on
  any element (theme/tokens.css), so a tile is the
  real palette, not a picture of one.

  Every choice saves as you go: the theme through
  theme/theme.ts, the candles through the candle
  theme store every chart reads, the ruler through
  the desk-wide unit.
==================================================
*/

import { Fragment, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import CardTabs from '../../components/ui/CardTabs';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CreditCard, Download, ExternalLink, FileText, Info, Keyboard, LayoutDashboard, LogOut, MonitorSmartphone, Palette, Plug, Trash2, Upload, UserRound, Users, Volume2, type LucideIcon } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import Modal from '../../components/ui/Modal';
import { MorphingInfinity, useBusy } from '../../components/ui/Working';
import { Door, Field, Row, Said, Section, Tag } from './pieces';
/* THE PEOPLE ROOM'S GRID (AG Grid, 326 KB on the wire) loads only when an owner opens People — imported plainly it rode
   along with every Settings page for everyone (the speed pass, 2026-10-11) */
const PeopleBox = lazy(() => import('./People'));
import Simulator from '../../core/simulator';
import { NAV_ITEMS } from '../../components/layout/nav';
import { chime } from '../../core/sound';
import { TIMEFRAMES, type Timeframe } from '../../data/timeframe';
import { setDeskPrefs, useDeskPrefs, type ClockZone } from '../../data/deskPrefs';
import { setProfile, useProfile, type SignInWay } from '../../data/profile';
import { ACCOUNTS_ON } from '../../data/supabase';
import { checkPassword, deleteAccount, leaveAfterDelete, reloadProfile, setPassword, signOut, useAccount } from '../../data/account';
import { grantHeld, PLAN_RANK, setViewAs, useAccess, type ViewAs } from '../../data/access';
import PictureDrop from './PictureDrop';
import { BILLING_ON, PLANS, STATUS_WORD, fmtDate, fmtDollars, fmtWhen, openPortal, planKeyOf, planOf, priceOf, setPlan, useBilling, type Period, type SubscriptionStatus } from '../../data/billing';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import { CANDLE_THEME_OPTIONS, setCandleTheme, useCandleThemeKey, type CandleThemeKey } from '../../components/gex/candleTheme';
import ColoursSwitch from '../../components/gex/ColoursSwitch';
import { setLedgerPalette, useLedgerPalette } from '../../data/ledgerPalette';
import { setDistanceUnit, useDistanceUnit } from '../../data/distanceUnits';
import type { DistanceUnit } from '../../data/atr';
import { setColourVision, setThemeChoice, useColourVision, useResolvedTheme, useThemeChoice, type ColourVision, type ThemeChoice } from '../../theme/theme';
import type { CSSProperties } from 'react';
import SlayerMark from '../../brand/SlayerMark';
import Wordmark from '../../brand/Wordmark';

/* ---- the sections ------------------------------------------------------------- */

/* EACH SECTION IS ITS OWN PAGE (Noah, 2026-09-12: "the subtabs should be
   subpages not all on the same page. transition should be smooth") —
   /settings/<id>, the rail a row of links, one box at a time, the box
   arriving on a short cross-fade. /settings alone lands on Account.
   THE ORDER IS THE READER'S PRIORITY (Noah, 2026-09-14: "account and billing
   is the most important, so those should be first"): the reader's own things
   — the account, the plan, the data — then how the terminal looks and works,
   then About. */
export type SettingsSection = 'account' | 'people' | 'billing' | 'data' | 'appearance' | 'desk' | 'keyboard' | 'about';
export const SETTINGS_SECTIONS: SettingsSection[] = ['account', 'people', 'billing', 'data', 'appearance', 'desk', 'keyboard', 'about'];
const isSection = (v: string | undefined): v is SettingsSection => (SETTINGS_SECTIONS as string[]).includes(v ?? '');
const HOME_SECTION: SettingsSection = 'account';

/* `owners`: a section only an owner — or, since 2026-10-17, the team, who read it — sees on the rail (People, 2026-10-10:
   the admin room, under Account since it is the owners' own thing, not a trading page for the terminal's rail); `gap`: a
   breath on the rail before it, the groups */
const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon; soon?: boolean; owners?: boolean; gap?: boolean }[] = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'people', label: 'People', icon: Users, owners: true },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'data', label: 'Data', icon: Plug },
  { id: 'appearance', label: 'Appearance', icon: Palette, gap: true },
  { id: 'desk', label: 'The desk', icon: LayoutDashboard },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info, gap: true },
];

const THEME_WORDS: Record<ThemeChoice, [string, string]> = {
  dark: ['Dark', 'The terminal as it is'],
  light: ['Light', 'A first cut, walked page by page'],
  system: ['Match the system', "Follows the machine's own setting"],
};

/** The desk's ruler: the unit every distance on Pinpoint is read in (the shell head's card, here too) */
const RULER_OPTIONS: DropdownOption<DistanceUnit>[] = [
  { value: '$', label: '$', hint: 'Dollars from spot' },
  { value: '%', label: '%', hint: 'Percent of spot' },
  { value: 'ATR', label: 'ATR', hint: 'Average true ranges — the same distance on SPY and on NVDA' },
  { value: 'σ', label: 'σ', hint: 'Expected one-day moves — how many the options price in' },
];

/* THE DESK'S ROWS — the name and the timeframe a desk opens on, the clock */
const OPENS_ON_NAMES: DropdownOption<string>[] = [
  { value: '', label: 'Where you left off', hint: 'The name the terminal last had up' },
  ...Simulator.WATCHLIST.map(t => ({ value: t, label: t, hint: `Every visit opens on ${t}` })),
];
const OPENS_ON_TIMEFRAMES: DropdownOption<string>[] = [
  { value: '', label: "Each desk's own", hint: 'Pulse and the Weigher at 1m, the Map at 15m' },
  ...TIMEFRAMES.filter(t => t.value !== '15s').map(t => ({ value: t.value, label: t.label, hint: `Every chart opens at ${t.label}` })),
];
/* THE PAGE THE TERMINAL OPENS ON (2026-10-03, the start page): the start page itself, or any page of the rail — where the
   landing's launch door lands (pages/landing/pieces.tsx doorTo) */
const OPENS_ON_PAGES: DropdownOption<string>[] = [
  { value: '', label: 'The start page', hint: 'Every page, one picture each — pick where to go' },
  ...NAV_ITEMS.filter(i => i.glyph && i.path !== '/community').map(i => ({ value: i.path, label: i.label, hint: `Every launch opens on ${i.label}` })),
];
const CLOCK_OPTIONS: DropdownOption<ClockZone>[] = [
  { value: 'local', label: 'Your own', hint: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "The machine's zone"; } })() },
  { value: 'ny', label: 'New York', hint: "The market's clock — the open at 09:30, the close at 16:00" },
];

/* EVERY KEY THE TERMINAL ANSWERS TO, grouped by where it works (Noah,
   2026-09-13, on the page listing six: "do you think it's too short?" — it was
   under-listed, not too short: Terrain's desk answers to twelve more). Each
   group's keys are read off the handler that owns them — AppShell (the
   palette), CommandPalette (its list), Terrain's pane keys, ResetViewControl
   (Alt+R while the pointer is over a chart), the script editor's keymap
   (Mod-s, Mod-Enter). `alt` marks keys that are alternatives ("1 / 2 / 3 / 4")
   rather than a chord ("Ctrl + K"). */
type Shortcut = { keys: string[]; does: string; alt?: boolean };
const KEY_GROUPS: { where: string; keys: Shortcut[] }[] = [
  {
    where: 'Everywhere',
    keys: [
      { keys: ['Ctrl', 'K'], does: 'Search a name or a page from anywhere' },
      { keys: ['↑', '↓'], alt: true, does: "Walk the search's results" },
      { keys: ['Enter'], does: 'Open the result under the mark' },
      { keys: ['Esc'], does: 'Close what is open — a menu, the alerts, the watchlist, the ladder (from inside it), fullscreen, a replay, the calendar’s focus' },
    ],
  },
  {
    where: 'Terrain · the desk',
    keys: [
      { keys: ['1', '2', '3', '4'], alt: true, does: 'How many charts — one to four' },
      { keys: ['[', ']'], alt: true, does: 'Walk the charts — the one before, the one after' },
      { keys: ['Shift', 'R'], does: 'The strike rail beside every chart — on or off' },
    ],
  },
  {
    where: 'Terrain · the active chart',
    keys: [
      { keys: ['F'], does: 'Expand it to the full screen, and back' },
      { keys: ['S'], does: 'Pick its symbol' },
      { keys: ['C'], does: 'Compare — cross another name onto it' },
      { keys: ['↑', '↓'], alt: true, does: 'Flip its name through the watchlist' },
      { keys: ['−', '='], alt: true, does: 'Step its timeframe down, up' },
      { keys: ['P'], does: 'Replay — pick a bar, then play' },
      { keys: ['D'], does: 'Draw mode — the tools in hand' },
      { keys: ['R'], does: 'Its strike rail — on or off' },
      { keys: ['Alt', 'R'], does: 'Reset its view — with the pointer over the chart' },
    ],
  },
  {
    where: 'Review · the backtest desk',
    keys: [
      { keys: ['Space'], does: 'Play the clock, and pause it' },
      { keys: ['←', '→'], alt: true, does: 'Step a minute back, a minute on — never back past your last order' },
      { keys: ['Shift', '→'], does: 'Five minutes on (Shift ← for five back)' },
      { keys: ['End'], does: 'Run to the bell — a futures session: to 17:00' },
      { keys: ['9'], does: 'A futures session: run to 09:30, the stock market’s open' },
      { keys: ['N'], does: 'Ring the bell and open the next day' },
      { keys: ['F'], does: 'The chart to the full screen, and back' },
      { keys: ['D'], does: 'Draw mode on the chart in hand' },
      { keys: ['T'], does: 'To the order — its size, ready to type' },
      { keys: ['1', '2'], alt: true, does: 'Put the first name on the desk, or the second' },
      { keys: ['\\'], does: 'In the full screen: fold the chain away, and back' },
    ],
  },
  {
    where: 'Review · a trade in the journal',
    keys: [
      { keys: ['←', '→'], alt: true, does: 'The trade closed after this one, or the one before — the journal’s own order' },
      { keys: ['Esc'], does: 'Back to the journal, as you left it' },
    ],
  },
  {
    where: 'The script editor',
    keys: [
      { keys: ['Ctrl', 'S'], does: 'Save the script' },
      { keys: ['Ctrl', 'Enter'], does: 'Run it on its chart' },
    ],
  },
];

/** The version the About box prints — package.json's, by hand until the build stamps it */
const VERSION = '1.0.0';

/* ---- the pieces --------------------------------------------------------------- */

/** The house mark — the rail's S|, the badge here */
const Mark = ({ size = 24 }: { size?: number }) => <SlayerMark size={size} bare label="" />;

/* THE PIECES — Section, Row, Door, Tag, Field, Said — live in pieces.tsx since 2026-10-10, shared with the People room */

/** The terminal, small, in one theme — real tokens under a scoped attribute */
const Mini = ({ theme }: { theme: 'dark' | 'light' }) => (
  <div data-theme={theme} className="relative h-full w-full bg-canvas overflow-hidden" aria-hidden>
    <div className="absolute inset-y-0 left-0 w-[22%] bg-panel border-r border-borderSubtle" />
    <div className="absolute left-[30%] top-[11%] h-[5px] w-[38%] rounded-[2px] bg-textPrimary" />
    <div className="absolute left-[30%] right-[8%] top-[27%] h-px bg-borderSubtle" />
    <div className="absolute left-[30%] right-[36%] top-[38%] bottom-[10%] rounded-[3px] border border-borderSubtle bg-panel" />
    <div className="absolute right-[8%] top-[38%] bottom-[10%] w-[24%] rounded-[3px] border border-borderSubtle bg-panel" />
    <span className="absolute left-[38%] top-[56%] h-[22%] w-[2px] rounded-full bg-bull" />
    <span className="absolute left-[44%] top-[50%] h-[30%] w-[2px] rounded-full bg-bear" />
    <span className="absolute left-[50%] top-[60%] h-[18%] w-[2px] rounded-full bg-bull" />
    <span className="absolute left-[56%] top-[52%] h-[26%] w-[2px] rounded-full bg-bull" />
    <span className="absolute right-[13%] top-[48%] h-[5px] w-[12%] rounded-full bg-bull/70" />
    <span className="absolute right-[13%] top-[62%] h-[5px] w-[9%] rounded-full bg-bear/70" />
    <span className="absolute right-[13%] top-[76%] h-[5px] w-[14%] rounded-full bg-bull/70" />
  </div>
);

const ThemeTile = ({ choice, current, onPick }: { choice: ThemeChoice; current: ThemeChoice; onPick: (c: ThemeChoice) => void }) => {
  const on = choice === current;
  const [name, line] = THEME_WORDS[choice];
  return (
    <button
      type="button"
      onClick={() => onPick(choice)}
      aria-pressed={on}
      title={line}
      className={`text-left rounded-md border p-2 transition-colors ${on ? 'border-silver/60 bg-ink/[0.02]' : 'border-borderSubtle hover:border-borderMuted'}`}
      data-theme-tile={choice}
      data-on={on || undefined}
    >
      {/* taller since 2026-09-12 (Noah: "make the appearance boxes taller") — the terminal reads as one */}
      <div className="h-[132px] rounded border border-borderSubtle overflow-hidden">
        {choice === 'system' ? (
          <div className="flex h-full">
            <div className="w-1/2 h-full">
              <Mini theme="dark" />
            </div>
            <div className="w-1/2 h-full">
              <Mini theme="light" />
            </div>
          </div>
        ) : (
          <Mini theme={choice} />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[12px] ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>{name}</span>
        {/* Silver, where you are — never lime: THE HOUSE CHECKBOX (the menus'
            filled square with the dark tick), not a bare mark (Noah,
            2026-09-12: "make the checkmark a blue checkbox instead on the
            active theme") */}
        {on && (
          <span className="inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border bg-silverFill border-silverFill" data-theme-check>
            <Check className="w-2.5 h-2.5 text-[#0a0a0a]" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="text-[11px] text-textMuted">{line}</div>
    </button>
  );
};

/* DIRECTION COLOURS (2026-10-13, the partner's setting at Noah's word): the house's green and red, or blue and orange
   for red–green colour blindness, or the pair stronger with the quieter words nearer the lead ink — with ▲ and ▼ on
   every signed figure under either choice (theme/tokens.css). Each tile shows its own pair whatever is chosen. */
const CVD_WORDS: Record<ColourVision, [string, string]> = {
  standard: ['Green and red', 'Up in green, down in red — the house’s pair'],
  'blue-orange': ['Blue and orange', 'For red–green colour blindness: up in blue, down in orange, with ▲ and ▼'],
  'high-contrast': ['High contrast', 'The house’s pair stronger, the quieter words darker on paper and brighter on black, with ▲ and ▼'],
};
const CVD_CHOICES: ColourVision[] = ['standard', 'blue-orange', 'high-contrast'];
/* the channels tokens.css gives each pair, kept in step with it */
const CVD_PAIR: Record<ColourVision, Record<'dark' | 'light', [string, string]>> = {
  standard: { dark: ['48 209 88', '255 59 48'], light: ['0 140 56', '220 32 32'] },
  'blue-orange': { dark: ['80 164 255', '255 133 38'], light: ['0 104 200', '196 72 0'] },
  'high-contrast': { dark: ['110 245 140', '255 120 110'], light: ['0 100 36', '170 0 0'] },
};
const CvdTile = ({ choice, current }: { choice: ColourVision; current: ColourVision }) => {
  const on = choice === current;
  const theme = useResolvedTheme();
  const [name, line] = CVD_WORDS[choice];
  return (
    <button
      type="button"
      onClick={() => setColourVision(choice)}
      aria-pressed={on}
      title={line}
      className={`text-left rounded-md border p-3 flex flex-col gap-2 transition-colors ${on ? 'border-silver/60 bg-ink/[0.02]' : 'border-borderSubtle hover:border-borderMuted'}`}
      data-cvd-tile={choice}
      data-on={on || undefined}
    >
      {/* the pair as it will read, in the tile's own scope so it shows its own colours whatever is chosen */}
      <span className="flex items-center gap-3 font-mono text-[12px] tnum" data-cvd-sample={choice} style={{ '--bull': CVD_PAIR[choice][theme][0], '--bear': CVD_PAIR[choice][theme][1] } as CSSProperties}>
        <span className="text-bull">{choice !== 'standard' ? '▲ ' : ''}+1.24%</span>
        <span className="text-bear">{choice !== 'standard' ? '▼ ' : ''}−0.87%</span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className={`text-[12px] ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>{name}</span>
        {on && (
          <span className="inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border bg-silverFill border-silverFill" data-cvd-check>
            <Check className="w-2.5 h-2.5 text-[#0a0a0a]" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="text-[11px] text-textMuted">{line}</span>
    </button>
  );
};

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex items-center h-5 px-1.5 rounded border border-borderSubtle bg-chip font-mono text-[10px] text-textSecondary">{children}</kbd>
);

/* ---- the page ----------------------------------------------------------------- */

/* ---- the launch pages, on the seam --------------------------------------------
   Account, Billing and Data are THE LAUNCH PAGES drawn now (Noah, 2026-09-12:
   "i just want the preview of how things would look after apis are plugged in
   and stripe is purchased") — the terminal's own doctrine: the page against
   a frozen shape (data/profile.ts, data/billing.ts), a sample on this machine
   underneath, the service swapped in later. What can be real today IS real:
   the picture, the name, the handle, the plan switch, the export, the clear.
   A door the service alone can open (Stripe's portal, sign out) says what it
   will do; the head's tag says the ground is a sample. */

const checkEmail = (v: string): string | null => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'That is not an email address');
const checkHandle = (v: string): string | null => {
  const h = v.replace(/^@/, '');
  if (/\s/.test(h)) return 'One word, no spaces';
  if (!/^[A-Za-z0-9_]+$/.test(h)) return 'Letters, numbers and _ only';
  if (h.length < 3 || h.length > 20) return 'Between 3 and 20 characters';
  return null;
};
const checkName = (v: string): string | null => (v.length > 40 ? 'Forty characters at most' : null);

const SIGN_IN_OPTIONS: DropdownOption<SignInWay>[] = [
  { value: 'email', label: 'Email link', hint: 'A one-time link to your inbox — no password' },
  { value: 'google', label: 'Google', hint: 'Your Google account' },
  { value: 'apple', label: 'Apple', hint: 'Your Apple ID' },
];

/** ACCOUNT, THE PREVIEW — the sample account, on a build without the account service (.env.local unset) */
const AccountPreview = () => {
  const p = useProfile();
  return (
    <Section id="account" title="Account" line="Who you are to the terminal — your picture and name sign your posts; your board, marks and settings follow you between machines" aside={<Tag>preview · sample account</Tag>}>
      {/* THE PICTURE — a place to drop one: staged, shown as it will be kept, applied only when you say so (PictureDrop.tsx) */}
      <PictureDrop />
      <Row name="Name" line="How the terminal greets you and signs your posts" testId="name">
        <Field value={p.name} onSave={v => setProfile({ name: v })} check={checkName} testId="name" />
      </Row>
      <Row name="Handle" line="Your name on Community — one word, yours alone" testId="handle">
        <Field value={p.handle} prefix="@" onSave={v => setProfile({ handle: v.replace(/^@/, '').toLowerCase() })} check={checkHandle} testId="handle" />
      </Row>
      <Row name="Email" line="Where sign-in links and receipts go" testId="email">
        <Field value={p.email} type="email" width={240} onSave={v => setProfile({ email: v })} check={checkEmail} testId="email" />
      </Row>
      <Row name="Sign in with" line="A link to your inbox, or the account you already have — no password to keep" testId="sign-in-way">
        <DropdownSelect<SignInWay> label="Sign in" value={p.signIn} options={SIGN_IN_OPTIONS} onChange={v => setProfile({ signIn: v })} title="How you sign in" testId="settings-sign-in" align="end" />
      </Row>
      {/* WHERE YOU ARE SIGNED IN */}
      <div className="px-5 py-3 border-t border-borderSubtle/60" data-settings-row="devices">
        <div className="text-[12px] text-textPrimary">Where you're signed in</div>
        <div className="text-[11px] text-textMuted">Every machine with this account open — sign one out from here</div>
        <ul className="mt-2.5 flex flex-col gap-1">
          {p.devices.map(d => (
            <li key={d.id} className="flex items-center gap-3 h-8 px-3 rounded-md bg-ink/[0.03]" data-settings-device={d.id}>
              <MonitorSmartphone className="w-3.5 h-3.5 text-textMuted shrink-0" />
              <span className="font-mono text-[11px] text-textPrimary">{d.name}</span>
              {d.thisOne && <Tag tone="silver">this machine</Tag>}
              <span className="ml-auto font-mono text-[10px] tnum text-textMuted">{d.lastSeen}</span>
              {!d.thisOne && (
                <button type="button" onClick={() => setProfile({ devices: p.devices.filter(x => x.id !== d.id) })} className="font-mono text-[10px] uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors" data-settings-device-out={d.id}>
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {/* THE FOOT — leaving, and the one dangerous thing, set apart in the bear's ink */}
      <div className="px-5 py-3 border-t border-borderSubtle/60 flex items-center justify-between gap-6" data-settings-row="account-foot">
        <div className="text-[11px] text-textMuted">Signing out keeps everything on the account · deleting it takes the board, the marks and the scripts with it</div>
        <div className="shrink-0 flex items-center gap-2">
          <Door title="Signs this machine out of the account" testId="sign-out">
            <LogOut className="w-3 h-3" /> Sign out
          </Door>
          <Door tone="bear" title="Asks twice, then deletes the account and everything on it" testId="delete-account">
            <Trash2 className="w-3 h-3" /> Delete account
          </Door>
        </div>
      </div>
    </Section>
  );
};

/* ---- the account, live (2026-10-03: auth at Noah's word — email and password on Supabase Auth, the terminal open while
   signed out until billing exists; data/account.ts holds the doors, the database holds the rules) ------------------- */

/** SIGNED IN: change the password from its row */
const PasswordChange = () => {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [, run] = useBusy();
  if (!open)
    return (
      <Door
        onClick={() => {
          setOpen(true);
          setDone(false);
        }}
        testId="password-change"
      >
        {done ? 'Changed' : 'Change password'}
      </Door>
    );
  const go = () =>
    run(async () => {
      const why = checkPassword(pw);
      if (why) return setProblem(why);
      const r = await setPassword(pw);
      if (!r.ok) return setProblem(r.why);
      setPw('');
      setOpen(false);
      setDone(true);
    });
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pw}
          autoComplete="new-password"
          placeholder="new password"
          onChange={e => {
            setPw(e.target.value);
            setProblem(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') go();
            if (e.key === 'Escape') setOpen(false);
          }}
          className="h-7 w-[200px] rounded-md border border-borderSubtle bg-chip px-2 font-mono text-[11px] text-textPrimary outline-none focus:border-borderMuted"
          data-account-field="change-password"
        />
        <Door onClick={go} tone="silver" testId="password-keep">
          Keep
        </Door>
        <Door onClick={() => setOpen(false)} testId="password-cancel">
          Cancel
        </Door>
      </div>
      <Said problem={problem} note={null} />
    </div>
  );
};

/** SIGNED IN: THE DOOR OUT FOR GOOD (2026-10-10, Noah: "build the delete account door"). One ask, answered in the person's
    own email — a word to type works for a Google sign-in as well as a password; then the function ends the plan on Stripe
    and deletes the account, the database cascading the rest (data/account.ts deleteAccount). The last owner is refused by
    the function and told to hand the seat on first. "Deleted" stays up for a breath, then the front page loads clean. */
const DeleteAccount = ({ email, planName }: { email: string; planName: string | null }) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [gone, setGone] = useState(false);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  const close = () => {
    if (working || gone) return;
    setOpen(false);
    setTyped('');
    setProblem(null);
  };
  const go = async () => {
    if (!matches || working || gone) return;
    setWorking(true);
    setProblem(null);
    try {
      const r = await deleteAccount(typed);
      if (!r.ok) return setProblem(r.why);
      setGone(true);
      window.setTimeout(() => void leaveAfterDelete(), 1400);
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <Door tone="bear" onClick={() => setOpen(true)} title="Asks first, then deletes the account and everything on it" testId="delete-account">
        <Trash2 className="w-3 h-3" /> Delete account
      </Door>
      <Modal open={open} onClose={close} ariaLabel="Delete the account" header={<span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">Delete the account?</span>} widthClass="max-w-[480px]">
        {gone ? (
          <p className="text-[12px] text-textPrimary" data-account-deleted>
            Deleted. Taking you to the front page.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-textPrimary">
              {planName ? `Your ${planName} plan ends now, with no refund of the rest of the period. ` : ''}
              Your picture, name and handle go, and everything the account carried between machines — the watchlist, the boards, the desks, the journal, these settings. It cannot be undone.
            </p>
            <p className="text-[11px] text-textMuted">Receipts stay in our books, as the law asks. Nothing else of yours is kept.</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-textMuted">Type your email to confirm</span>
              <input
                type="email"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                placeholder={email}
                onChange={e => {
                  setTyped(e.target.value);
                  setProblem(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') void go();
                }}
                className="h-8 w-full rounded-md border border-borderSubtle bg-chip px-2.5 font-mono text-[11px] text-textPrimary outline-none focus:border-borderMuted"
                data-account-field="delete-email"
              />
            </label>
            <Said problem={problem} note={null} />
            <div className="flex items-center justify-end gap-2">
              <Door onClick={close} testId="delete-cancel">
                Keep the account
              </Door>
              <Door tone="bear" onClick={go} disabled={!matches} title={matches ? 'Deletes the account now' : 'Type the email above first'} testId="delete-confirm">
                <Trash2 className="w-3 h-3" /> Delete the account
              </Door>
            </div>
          </>
        )}
      </Modal>
    </>
  );
};

/** ACCOUNT, LIVE — the account service behind every row */
const AccountLive = () => {
  const a = useAccount();
  const p = useProfile();
  const line = 'Who you are to the terminal — your picture and name sign your posts and follow you between machines';
  if (a.status === 'loading')
    return (
      <Section id="account" title="Account" line={line} aside={<Tag>signing in…</Tag>}>
        <div className="px-5 py-6 flex items-center gap-2 text-[11px] text-textMuted border-t border-borderSubtle/60">
          <MorphingInfinity viewBox="4 4 16 16" className="w-3.5 h-3.5" /> Asking whether you are signed in
        </div>
      </Section>
    );
  if (a.recovering)
    return (
      <Section id="account" title="Account" line="You opened a reset link — choose the new password on the sign-in page" aside={<Tag>new password</Tag>}>
        <div className="px-5 py-4 border-t border-borderSubtle/60">
          <Door to="/signin" tone="silver" testId="account-new-password">
            Choose the new password
          </Door>
        </div>
      </Section>
    );
  if (a.status !== 'in' || !a.user)
    return (
      <Section id="account" title="Account" line="Sign in to keep your picture, name and handle with you between machines" aside={<Tag>signed out</Tag>}>
        {/* the sign-in itself is a page of its own (pages/signin/SignIn.tsx, Noah's picture of 2026-10-03); these two doors
            go there and come back here */}
        <div className="px-5 py-4 border-t border-borderSubtle/60 flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3" data-account-signed-out>
          <div className="text-[11px] text-textMuted">The terminal stays open without an account. Sign in, or create one, on its own page.</div>
          <div className="shrink-0 flex items-center gap-2">
            <Door to="/signin?next=%2Fsettings%2Faccount" tone="silver" testId="account-sign-in">
              Sign in
            </Door>
            <Door to="/signin?face=up&next=%2Fsettings%2Faccount" testId="account-create">
              Create an account
            </Door>
          </div>
        </div>
      </Section>
    );
  const owner = a.profile?.role === 'owner';
  const team = a.profile?.role === 'team';
  /* the plan the delete would end — only one that stands; a cancelled or absent plan has nothing to end */
  const stands = a.profile && a.profile.plan !== 'none' && (a.profile.planStatus === 'active' || a.profile.planStatus === 'trialing' || a.profile.planStatus === 'past_due');
  const planName = stands && a.profile ? planOf(planKeyOf(a.profile.plan)).name : null;
  return (
    <Section id="account" title="Account" line={line} aside={<Tag tone={owner ? 'silver' : 'plain'}>{owner ? 'owner' : team ? 'team' : 'signed in'}</Tag>}>
      {/* THE PICTURE — a place to drop one: staged, shown as it will be kept, applied only when you say so (PictureDrop.tsx) */}
      <PictureDrop />
      <Row name="Name" line="How the terminal greets you and signs your posts" testId="name">
        <Field value={p.name} onSave={v => setProfile({ name: v })} check={checkName} testId="name" />
      </Row>
      <Row name="Handle" line="Your name on Community — one word, yours alone" testId="handle">
        <Field value={p.handle} prefix="@" onSave={v => setProfile({ handle: v.replace(/^@/, '').toLowerCase() })} check={checkHandle} testId="handle" />
      </Row>
      <Row name="Email" line="Where sign-in and reset links go — changing it will come with the account's own mail" testId="email">
        <span className="font-mono text-[11px] text-textPrimary" data-account-email>
          {a.user.email}
        </span>
      </Row>
      <Row name="Password" line="Change it here; a reset link reaches your inbox if you forget it" testId="password">
        <PasswordChange />
      </Row>
      {/* THE FOOT — leaving, and the one dangerous thing, set apart in the bear's ink */}
      <div className="px-5 py-3 border-t border-borderSubtle/60 flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3" data-settings-row="account-foot">
        <div className="text-[11px] text-textMuted">Signing out keeps everything on the account · deleting it ends the plan and takes everything on the account with it</div>
        <div className="shrink-0 flex items-center gap-2">
          <Door onClick={() => signOut()} title="Signs this machine out of the account" testId="sign-out">
            <LogOut className="w-3 h-3" /> Sign out
          </Door>
          <DeleteAccount email={a.user.email} planName={planName} />
        </div>
      </div>
    </Section>
  );
};

/** ACCOUNT — the live box on a build with the account service; the preview on the sample without one */
const AccountBox = () => (ACCOUNTS_ON ? <AccountLive /> : <AccountPreview />);

const SAMPLE_STATUS_WORD: Record<SubscriptionStatus, string> = { active: 'active', past_due: 'payment due', canceled: 'ending', trialing: 'trial' };

const PERIOD_TABS = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
] as const;
/* AN OWNER'S EYES (2026-10-10): the terminal as a plan sees it, for this browser session — data/access.ts */
const VIEW_AS_OPTIONS: DropdownOption<ViewAs>[] = [
  { value: 'self', label: 'Yourself', hint: 'An owner — every room open' },
  { value: 'none', label: 'No plan', hint: 'Signed in, nothing bought — every room walled' },
  { value: 'book', label: 'Book', hint: 'Pulse, Terrain, Pinpoint' },
  { value: 'tape', label: 'Tape', hint: 'Book, plus Trace, Dossier and Scripts' },
  { value: 'desk', label: 'Desk', hint: 'Everything' },
];
const STANDS = new Set(['active', 'trialing', 'past_due']);

/** BILLING, LIVE (2026-10-10 — Stripe in test mode): the plan and its standing off the profile row, where Stripe's
    webhook writes them; a plan chosen goes to Stripe's hosted checkout, a plan held goes to the portal; the card and
    the invoices live on the portal, never here. Back from checkout the row is read again until Stripe's word lands. */
const BillingLive = () => {
  const a = useAccount();
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>('month');
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const checkout = params.get('checkout');
  const wantPlan = params.get('plan');
  const wantPeriod = params.get('period');
  const say = (r: { ok: boolean; why?: string }) => {
    if (!r.ok) setProblem(r.why ?? 'Billing did not answer.');
  };
  /* back from Stripe: say so, and read the row again every two seconds until the plan has landed (the webhook is a
     breath behind the redirect) */
  useEffect(() => {
    if (checkout === 'success') {
      setNote('Thank you. Stripe is confirming the payment — the plan lands here in a moment.');
      let tries = 0;
      const t = window.setInterval(() => {
        void reloadProfile();
        if (++tries >= 12) window.clearInterval(t);
      }, 2000);
      return () => window.clearInterval(t);
    }
    if (checkout === 'cancel') setNote('Nothing was charged.');
  }, [checkout]);
  /* back from Stripe and the row shows the plan standing: say so, stop asking, and let the address go */
  const landed = a.status === 'in' && !!a.profile && STANDS.has(a.profile.planStatus);
  useEffect(() => {
    if (checkout !== 'success' || !landed) return;
    setNote('Thank you. The plan is in.');
    setParams({}, { replace: true });
  }, [checkout, landed, setParams]);
  const line = 'Your plan and the card behind it — the card lives with Stripe, never here';
  /* an old link with a plan in hand goes to the hand-off page, which asks Stripe at once (2026-10-10 — this page used
     to make the checkout itself, and the person sat here three seconds wondering) */
  if (wantPlan) return <Navigate to={`/checkout?plan=${planKeyOf(wantPlan)}&period=${wantPeriod === 'year' ? 'year' : 'month'}`} replace />;
  if (a.status === 'loading')
    return (
      <Section id="billing" title="Billing" line={line} aside={<Tag>signing in…</Tag>}>
        <div className="px-5 py-6 flex items-center gap-2 text-[11px] text-textMuted border-t border-borderSubtle/60">
          <MorphingInfinity viewBox="4 4 16 16" className="w-3.5 h-3.5" /> Asking whether you are signed in
        </div>
      </Section>
    );
  if (a.status !== 'in' || !a.profile)
    return (
      <Section id="billing" title="Billing" line="Sign in to pick a plan — the terminal stays open without one" aside={<Tag>signed out</Tag>}>
        <div className="px-5 py-4 border-t border-borderSubtle/60 flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3" data-billing-signed-out>
          <div className="text-[11px] text-textMuted">A plan belongs to an account. Sign in, or create one, and the plans are a press away.</div>
          <div className="shrink-0 flex items-center gap-2">
            <Door to="/signin?next=%2Fsettings%2Fbilling" tone="silver" testId="billing-sign-in">
              Sign in
            </Door>
            <Door to="/signin?face=up&next=%2Fsettings%2Fbilling" testId="billing-create">
              Create an account
            </Door>
          </div>
        </div>
      </Section>
    );
  const p = a.profile;
  /* the plan held — read only where one is (p.plan !== 'none'); 'none' is not a sold plan */
  const held = planOf(p.plan === 'none' ? 'book' : p.plan);
  const stands = STANDS.has(p.planStatus);
  const heldPrice = p.plan !== 'none' ? priceOf(p.plan, p.planPeriod ?? 'month') : null;
  /* A PLAN GIVEN (2026-10-17): a complimentary plan an owner set in People — "legacy" — stands beside anything paid for;
     the page leads with it when it is all there is, or ranks higher, and says so: with our thanks, until a date */
  const given = grantHeld(p);
  const givenLeads = given != null && (p.plan === 'none' || !stands || PLAN_RANK[given] > PLAN_RANK[p.plan]);
  const lead = givenLeads && given ? planOf(given) : held;
  return (
    <Section id="billing" title="Billing" line={line} aside={<Tag tone={stands || givenLeads ? 'silver' : 'plain'}>{BILLING_ON ? (givenLeads ? 'given' : STATUS_WORD[p.planStatus]) : 'billing off'}</Tag>}>
      {/* THE PLAN — what you are on, its standing, the next charge; the portal's door */}
      <div className="px-5 py-4 border-t border-borderSubtle/60 flex items-center gap-6 flex-wrap" data-settings-plan={p.plan} data-plan-status={p.planStatus} data-settings-given={given ?? undefined}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[20px] font-semibold leading-tight text-textPrimary">{givenLeads ? lead.name : p.plan === 'none' ? 'No plan yet' : held.name}</span>
            {heldPrice && !givenLeads && (
              <span className="font-mono text-[12px] tnum text-textSecondary">
                {heldPrice.price} {heldPrice.period}
              </span>
            )}
            {givenLeads ? <Tag tone="silver">with our thanks</Tag> : p.plan !== 'none' && <Tag tone="silver">{STATUS_WORD[p.planStatus]}</Tag>}
          </div>
          <div className="mt-1 text-[11px] text-textMuted">
            {givenLeads
              ? `${lead.kicker} · given, with our thanks · until ${p.grantUntil ? fmtWhen(p.grantUntil) : '—'}${p.plan !== 'none' && stands ? ` · the ${held.name} you pay for stays` : ''}`
              : p.plan === 'none'
              ? 'No plan opens no rooms; Start and Settings stay open. Pick one below.'
              : p.planStatus === 'past_due'
                ? 'Payment due — the rooms are locked until the card clears. Stripe keeps trying it; update it on the portal and they open again.'
                : `${held.kicker} · ${p.planStatus === 'canceled' ? 'ends' : 'renews'} ${p.planRenewsOn ? fmtWhen(p.planRenewsOn) : '—'}`}
          </div>
          <div className="mt-1.5">
            <Said problem={problem} note={note} />
          </div>
        </div>
        <Door onClick={() => openPortal().then(say)} disabled={!p.hasBilling} title="Stripe's billing portal — the card, the invoices, cancelling" testId="manage-billing">
          <ExternalLink className="w-3 h-3" /> Manage billing
        </Door>
      </div>
      {/* THE TIERS — the plans as sold, by the month or the year; yours lit */}
      <div className="px-5 pb-4 border-t border-borderSubtle/60 pt-3" data-settings-row="plans">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[12px] text-textPrimary">Plans</div>
            <div className="text-[11px] text-textMuted">Month to month, or a year at two months free — stopping at the end of the period paid for</div>
          </div>
          <div data-billing-period={period}>
            <CardTabs<Period> options={PERIOD_TABS} value={period} onChange={setPeriod} ariaLabel="Billed" />
          </div>
        </div>
        <div className={`mt-3 grid ${PLANS.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-3 max-sm:grid-cols-1`}>
          {PLANS.map(t => {
            const on = stands && t.key === p.plan;
            const priced = priceOf(t.key, period);
            return (
              <div key={t.key} className={`rounded-md border p-3 flex flex-col gap-1 ${on ? 'border-silver/60 bg-ink/[0.02]' : 'border-borderSubtle'}`} data-settings-tier={t.key} data-on={on || undefined}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>{t.name}</span>
                  {on && (
                    <span className="inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border bg-silverFill border-silverFill">
                      <Check className="w-2.5 h-2.5 text-[#0a0a0a]" strokeWidth={3} />
                    </span>
                  )}
                </div>
                {/* the price rolls between the periods, as the landing's does */}
                <div className="font-mono text-[14px] font-semibold tnum text-textPrimary">
                  {priced.amount != null ? <AnimatedNumber value={priced.amount} format={fmtDollars} /> : priced.price}
                  <span className="text-[10px] font-normal text-textMuted"> {priced.period}</span>
                </div>
                <div className="text-[11px] text-textMuted">{priced.aMonth ?? t.kicker}</div>
                <div className="mt-2 h-7 flex items-center">
                  {on ? (
                    <Tag>your plan</Tag>
                  ) : (
                    stands ? (
                      <Door onClick={() => openPortal().then(say)} disabled={!BILLING_ON} title="Stripe's portal — where a plan changes" testId={`tier-${t.key}`}>
                        Switch
                      </Door>
                    ) : (
                      <Door to={`/checkout?plan=${t.key}&period=${period}`} disabled={!BILLING_ON} title="Our checkout page — the card goes into Stripe's own fields there, never ours" testId={`tier-${t.key}`}>
                        Choose
                      </Door>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* AN OWNER'S EYES — owners walk everywhere; this looks through a plan's instead, for this browser session only
          (Noah, 2026-10-10: "i would like to see what a user who only spends 80 sees") */}
      {access.owner && access.on && (
        <Row name="See the terminal as" line="You are an owner, so every room opens to you. Look through a plan's eyes instead — this screen only, nothing on your account changes" testId="view-as">
          <DropdownSelect<ViewAs> label="Seeing as" value={access.viewing} options={VIEW_AS_OPTIONS} onChange={setViewAs} title="The plan whose walls this screen shows" testId="settings-view-as" align="end" />
        </Row>
      )}
      <Row name="Card and invoices" line="What Stripe holds — the card, every charge and its receipt — on Stripe's own page, never typed here" testId="card">
        <Door onClick={() => openPortal().then(say)} disabled={!p.hasBilling} title="Opens Stripe's portal" testId="update-card">
          <ExternalLink className="w-3 h-3" /> Open the portal
        </Door>
      </Row>
    </Section>
  );
};

/** BILLING — the live box on a build with the account service; the preview on the sample without one */
const BillingBox = () => (ACCOUNTS_ON ? <BillingLive /> : <BillingPreview />);

/** BILLING, THE PREVIEW — the sample plan, the tiers, a sample card and invoices */
const BillingPreview = () => {
  const b = useBilling();
  const plan = planOf(b.plan);
  return (
    <Section id="billing" title="Billing" line="Your plan and the card behind it — the card lives with Stripe, never here" aside={<Tag>preview · sample plan</Tag>}>
      {/* THE PLAN — what you are on, its standing, the next charge */}
      <div className="px-5 py-4 border-t border-borderSubtle/60 flex items-center gap-6 flex-wrap" data-settings-plan={b.plan}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[20px] font-semibold leading-tight text-textPrimary">{plan.name}</span>
            <span className="font-mono text-[12px] tnum text-textSecondary">
              {plan.price} {plan.period}
            </span>
            <Tag tone="silver">{SAMPLE_STATUS_WORD[b.status]}</Tag>
          </div>
          <div className="mt-1 text-[11px] text-textMuted">
            {plan.kicker} · {b.status === 'canceled' ? 'ends' : 'renews'} {fmtDate(b.renewsOn)}
            {plan.monthly != null && ` · $${plan.monthly} then`}
          </div>
        </div>
        <Door title="Stripe's billing portal — the card, the invoices, cancelling" testId="manage-billing">
          <ExternalLink className="w-3 h-3" /> Manage billing
        </Door>
      </div>
      {/* THE TIERS — the landing's three, yours lit; up is Stripe's Checkout, down is the portal */}
      <div className="px-5 pb-4 border-t border-borderSubtle/60 pt-3" data-settings-row="plans">
        <div className="text-[12px] text-textPrimary">Plans</div>
        <div className="text-[11px] text-textMuted">Month to month, stopping at the end of the cycle</div>
        {/* as many columns as plans are sold — two while the Seat is off the page (data/billing.ts, 2026-10-05) */}
        <div className={`mt-3 grid ${PLANS.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
          {PLANS.map(t => {
            const on = t.key === b.plan;
            return (
              <div key={t.key} className={`rounded-md border p-3 flex flex-col gap-1 ${on ? 'border-silver/60 bg-ink/[0.02]' : 'border-borderSubtle'}`} data-settings-tier={t.key} data-on={on || undefined}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>{t.name}</span>
                  {on && (
                    <span className="inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border bg-silverFill border-silverFill">
                      <Check className="w-2.5 h-2.5 text-[#0a0a0a]" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="font-mono text-[14px] font-semibold tnum text-textPrimary">
                  {t.price}
                  <span className="text-[10px] font-normal text-textMuted"> {t.period}</span>
                </div>
                <div className="text-[11px] text-textMuted">{t.kicker}</div>
                <div className="mt-2 h-7 flex items-center">
                  {on ? (
                    <Tag>your plan</Tag>
                  ) : t.monthly == null ? (
                    <Door href="mailto:info@slayerterminal.com" title="A single payment, priced with you" testId={`tier-${t.key}`}>
                      Talk to us
                    </Door>
                  ) : (
                    <Door onClick={() => setPlan(t.key)} title={t.monthly != null && plan.monthly != null && t.monthly > plan.monthly ? "Stripe's Checkout — the difference, charged today" : 'Stripe changes the plan at the end of this cycle'} testId={`tier-${t.key}`}>
                      Switch
                    </Door>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Row name="Payment method" line="What Stripe holds — changed on its portal, never typed here" testId="card">
        {b.card ? (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] text-textPrimary">
            <CreditCard className="w-3.5 h-3.5 text-textMuted" />
            {b.card.brand} •••• {b.card.last4}
            <span className="text-textMuted tnum">
              · {String(b.card.expMonth).padStart(2, '0')}/{String(b.card.expYear).slice(2)}
            </span>
          </span>
        ) : (
          <span className="font-mono text-[11px] text-textMuted">No card on file</span>
        )}
        <Door title="Opens Stripe's portal on the card" testId="update-card">
          Update
        </Door>
      </Row>
      {/* THE INVOICES — every charge, its receipt from Stripe */}
      <div className="px-5 py-3 border-t border-borderSubtle/60" data-settings-row="invoices">
        <div className="text-[12px] text-textPrimary">Invoices</div>
        <div className="text-[11px] text-textMuted">Every charge, with its receipt</div>
        <table className="mt-2 w-full">
          <tbody>
            {b.invoices.map(inv => (
              <tr key={inv.id} className="h-8 border-t border-borderSubtle/40 first:border-t-0" data-settings-invoice={inv.id}>
                <td className="font-mono text-[11px] tnum text-textPrimary">{fmtDate(inv.date)}</td>
                <td className="font-mono text-[11px] text-textSecondary">{planOf(inv.plan).name}</td>
                <td className="font-mono text-[11px] tnum text-textPrimary text-right">${inv.amount.toFixed(2)}</td>
                <td className="text-right">
                  <Tag>{inv.status}</Tag>
                </td>
                <td className="text-right w-16">
                  <button type="button" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors" title="The receipt, from Stripe">
                    <FileText className="w-3 h-3" /> PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

/* What is yours on this machine: every key of ours in localStorage (the board,
   the marks, the alerts, the desks, these settings, the profile) — scripts
   live in the library's own store */
const OWN_PREFIX = 'slayer_';
const KEEP_ON_CLEAR = new Set(['slayer_boot_seen', 'slayer_theme']);
function localKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(OWN_PREFIX)) out.push(k);
  }
  return out;
}
function localBytes(): number {
  let n = 0;
  for (const k of localKeys()) n += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
  return n;
}
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
function exportLocal(): void {
  const keys: Record<string, string> = {};
  for (const k of localKeys()) keys[k] = localStorage.getItem(k) ?? '';
  const blob = new Blob([JSON.stringify({ app: 'slayer_terminal', version: VERSION, at: new Date().toISOString(), keys }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `slayer-terminal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importLocal(file: File): Promise<number> {
  const doc = JSON.parse(await file.text()) as { app?: string; keys?: Record<string, unknown> };
  if (doc.app !== 'slayer_terminal' || !doc.keys) throw new Error('not a terminal export');
  let n = 0;
  for (const [k, v] of Object.entries(doc.keys)) {
    if (k.startsWith(OWN_PREFIX) && typeof v === 'string') {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}
function clearLocal(): void {
  for (const k of localKeys()) if (!KEEP_ON_CLEAR.has(k)) localStorage.removeItem(k);
}

/** DATA — what's yours on this machine, and where the feed stands */
const DataBox = () => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bytes = localBytes();
  const bring = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = await importLocal(f);
      setNote(`${n} ${n === 1 ? 'thing' : 'things'} brought in — reloading`);
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      setNote('that file is not a terminal export');
    }
  };
  return (
    <Section id="data" title="Data" line="What's yours on this machine — the board, the marks, the alerts, the desks, these settings — and where the feed stands" aside={<Tag>preview · the feed is simulated</Tag>}>
      <Row name="The feed" line="Live options and quotes, the tape and the record — delayed while a payment is due" testId="feed">
        <span className="inline-flex items-center gap-2">
          <span className="tone-live rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest font-semibold">live</span>
          <span className="font-mono text-[11px] text-textMuted">every tick · the book every 10 seconds</span>
        </span>
      </Row>
      <Row name="Your board, marks and settings" line="A file of everything kept here, to carry to another machine or keep safe · scripts stay in the library" testId="carry">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            void bring(e.target.files?.[0]);
            e.target.value = '';
          }}
          data-settings-import-input
        />
        {note && <span className="font-mono text-[10px] text-textMuted">{note}</span>}
        <Door onClick={exportLocal} title="Downloads a file of what is kept here" testId="export">
          <Download className="w-3 h-3" /> Export
        </Door>
        <Door onClick={() => fileRef.current?.click()} title="Reads a file made by Export and reloads" testId="import">
          <Upload className="w-3 h-3" /> Import
        </Door>
      </Row>
      <Row name="On this machine" line="What this browser holds for the terminal — cleared, it starts as new, the account untouched" testId="storage">
        <span className="font-mono text-[11px] tnum text-textPrimary" data-settings-bytes={bytes}>
          {fmtBytes(bytes)}
        </span>
        <Door tone="bear" onClick={() => setConfirm(true)} title="Asks first" testId="clear">
          <Trash2 className="w-3 h-3" /> Clear
        </Door>
      </Row>
      <Modal open={confirm} onClose={() => setConfirm(false)} ariaLabel="Clear this machine's data" header={<span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">Clear this machine's data?</span>} widthClass="max-w-[460px]">
        <p className="text-[12px] text-textPrimary">The board, the marks, the alerts, the desks, these settings and the sample account go. The theme stays; the scripts in the library stay.</p>
        <p className="text-[11px] text-textMuted">Export first if any of it should come back.</p>
        <div className="flex items-center justify-end gap-2">
          <Door onClick={() => setConfirm(false)} testId="clear-cancel">
            Keep it
          </Door>
          <Door
            tone="bear"
            onClick={() => {
              clearLocal();
              window.location.reload();
            }}
            testId="clear-confirm"
          >
            <Trash2 className="w-3 h-3" /> Clear and reload
          </Door>
        </div>
      </Modal>
    </Section>
  );
};

/** ABOUT — the mark, the version, a word, the licences behind one door */
const AboutBox = () => {
  const [licences, setLicences] = useState(false);
  return (
    <Section id="about" title="About" line="The terminal and its version">
      <div className="px-5 py-4 border-t border-borderSubtle/60 flex items-center gap-4" data-settings-about>
        <Mark size={40} />
        <div className="min-w-0">
          <Wordmark height={13} label="" />
          <div className="mt-0.5 font-mono text-[11px] tnum text-textMuted">
            v{VERSION} · {import.meta.env.MODE}
          </div>
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-2">
          <Door to="/community" testId="say-something">
            The room
          </Door>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setLicences(v => !v)}
        aria-expanded={licences}
        className="w-full px-5 py-3 border-t border-borderSubtle/60 flex items-center justify-between gap-6 text-left hover:bg-ink/[0.02] transition-colors"
        data-settings-row="licences"
      >
        <div>
          <div className="text-[12px] text-textPrimary">Open-source licences</div>
          <div className="text-[11px] text-textMuted">Whose work the terminal stands on</div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-textMuted shrink-0 transition-transform duration-200 ${licences ? 'rotate-180' : ''}`} />
      </button>
      {licences && (
        <div data-settings-licences>
          <Row name="Charts" line="Drawn with TradingView's lightweight-charts, under the Apache 2.0 licence — the mark in the corner is theirs" testId="credit-charts" />
          <Row name="Grids" line="AG Grid Community, under the MIT licence" testId="credit-grids" />
          <Row name="Marks and glyphs" line="Company marks from thesvg.org · icons by Lucide, under the ISC licence" testId="credit-marks" />
        </div>
      )}
    </Section>
  );
};

const Settings = () => {
  const choice = useThemeChoice();
  const theme = useResolvedTheme();
  const cvd = useColourVision();
  const candleKey = useCandleThemeKey();
  /* THE MAP'S COLOURS (data/ledgerPalette.ts): a preference made once, off the Map's band since the partner's Map came
     (2026-10-14) — and never on paper, where the two ramps differ by nothing the eye can use (Noah, 2026-10-04) */
  const ledgerPalette = useLedgerPalette();
  const unit = useDistanceUnit();
  const desk = useDeskPrefs();
  const plan = planOf(useBilling().plan);
  /* the rail shows the owners' section to an owner — and on a build without the account service, where every launch page
     is a preview on a sample */
  const account = useAccount();
  const owner = !ACCOUNTS_ON || account.profile?.role === 'owner' || account.profile?.role === 'team';

  /* THE SUBPAGE — from the route; a step to another lands at the head */
  const { section } = useParams<{ section?: string }>();
  const current: SettingsSection = isSection(section) ? section : HOME_SECTION;
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main');
    if (main && main.scrollTop > 0) main.scrollTop = 0;
  }, [current]);
  if (!isSection(section)) return <Navigate to={`/settings/${HOME_SECTION}`} replace />;

  return (
    <>
      {/* THE HEAD — the house mark as the page's chip, the name, one line, the facts */}
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell data-settings-shell>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <Mark />
            <h1 className="text-[15px] font-semibold leading-tight text-textPrimary">Settings</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Your account and plan, how the terminal looks, what the desk opens on</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2" data-shell-facts>
          <div className="min-w-0">
            <dt className="text-[10px] text-textMuted whitespace-nowrap">Plan</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-settings-plan-fact={plan.key}>
              {plan.name}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] text-textMuted whitespace-nowrap">Theme</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-settings-theme={theme}>
              {THEME_WORDS[choice][0]}
              {choice === 'system' && <span className="text-textMuted"> · {theme}</span>}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] text-textMuted whitespace-nowrap">Saved</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">as you go</dd>
          </div>
        </dl>
      </header>

      {/* THE COLUMN IS THE FOOTER'S (Noah, 2026-09-12: "shorten the width of
          these cards… leaving more spacing on the right side", then, with a
          line drawn down the footer's last column: "a vertical line with the
          footer access column", and "when the sidebar is fully collapsed the
          left side needs to come closer to the middle") — the rail and the
          boxes sit in the footer's own measure: 1072px (max-w-6xl less its
          padding), centred in the page like the footer is, so the boxes' edges
          meet the footer's first and last columns whether the sidebar is out
          or in; the head stays full width, the shell grammar. A row's name and
          its control sit in one eye span; the window's sides stay quiet. */}
      <div className="grid grid-cols-1 xl:grid-cols-[168px_minmax(0,1fr)] gap-4 items-start w-full max-w-[1072px] mx-auto" data-settings>
        {/* THE RAIL — the subpages, the one open lit */}
        <nav className="xl:sticky xl:top-5 flex xl:flex-col gap-0.5 flex-wrap" aria-label="Settings sections" data-settings-rail>
          {SECTIONS.filter(s => !s.owners || owner).map(s => {
            const on = s.id === current;
            const Icon = s.icon;
            return (
              <Link
                key={s.id}
                to={`/settings/${s.id}`}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2 px-2.5 h-8 rounded-md text-[12px] transition-colors text-left ${
                  on ? 'bg-ink/[0.05] text-textPrimary' : s.soon ? 'text-textMuted hover:text-textSecondary' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.03]'
                } ${s.gap ? 'xl:mt-2' : ''}`}
                data-settings-nav={s.id}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                {s.label}
              </Link>
            );
          })}
        </nav>

        {/* ONE BOX AT A TIME, arriving on a short cross-fade — the old one leaves
            at once, the new one lands on the next frame (the shell's own rule:
            no exit wait, no black gap) with a breath of rise */}
        <AnimatePresence initial={false}>
          <motion.div
            key={current}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4 min-w-0"
            data-settings-page={current}
          >
          {/* APPEARANCE */}
          {current === 'appearance' && (
          <Section id="appearance" title="Appearance" line="The terminal drawn in each theme, not a swatch — the change lands in the same frame, on every page">
            <div className="px-5 pb-4 border-t border-borderSubtle/60 pt-3">
              <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
                {(['dark', 'light', 'system'] as ThemeChoice[]).map(c => (
                  <ThemeTile key={c} choice={c} current={choice} onPick={setThemeChoice} />
                ))}
              </div>
            </div>
            <div className="px-5 pb-4 border-t border-borderSubtle/60 pt-3" data-settings-row="colour-vision">
              <div className="text-[12px] text-textPrimary" id="cvd-head">
                Direction colours
              </div>
              <div className="text-[11px] text-textMuted">What up and down are drawn in — and, in high contrast, how strongly the quieter words stand — on every page and chart</div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-labelledby="cvd-head">
                {CVD_CHOICES.map(c => (
                  <CvdTile key={c} choice={c} current={cvd} />
                ))}
              </div>
            </div>
            <Row name="Candles" line="The chart's own theme — the same menu every chart carries. Kept apart for each theme above: Glacier to begin with on dark, Stone on light" testId="candles">
              <DropdownSelect<CandleThemeKey> label="Candles" value={candleKey} options={CANDLE_THEME_OPTIONS} onChange={setCandleTheme} title="The colours every chart draws its candles in" testId="settings-candles" align="end" />
            </Row>
            {theme !== 'light' && (
              <Row name="The book's colours" line="The ramp the Map's matrix and calendar are painted in — the house's ember and glacier, or the thermal try" testId="map-colours">
                <ColoursSwitch palette={ledgerPalette} onChange={setLedgerPalette} paper={false} testId="settings-colours" />
              </Row>
            )}
          </Section>
          )}

          {/* THE DESK */}
          {current === 'desk' && (
          <Section id="desk" title="The desk" line="What every desk reads by — carried by your account when you are signed in, so it follows you between machines">
            <Row name="Ruler" line="The default unit a name uses until you set one on its strip. Dollars, percent, ATR, or the expected move." testId="ruler">
              <DropdownSelect<DistanceUnit> label="Ruler" value={unit} options={RULER_OPTIONS} onChange={setDistanceUnit} title="The default ruler. A name you set on Pinpoint keeps its own." testId="settings-ruler" align="end" />
            </Row>
            {/* THE DESK'S OWN ROWS, LIVE (Noah, 2026-09-12: "make the desk buttons
                actually have the function behind them") — data/deskPrefs.ts;
                the hosts read them at their first render, the bell at every
                ring, the chart clock at every label */}
            <Row name="Opens on" line="The page the launch door opens, and the name and the timeframe every desk starts on — from the next visit" testId="opens-on">
              <DropdownSelect<string> label="Page" value={desk.opensOn.page ?? ''} options={OPENS_ON_PAGES} onChange={v => setDeskPrefs({ opensOn: { page: v || null } })} title="The page the landing's launch door opens" testId="settings-opens-page" align="end" />
              <DropdownSelect<string> label="Name" value={desk.opensOn.ticker ?? ''} options={OPENS_ON_NAMES} onChange={v => setDeskPrefs({ opensOn: { ticker: v || null } })} title="The name the terminal opens on" testId="settings-opens-name" align="end" />
              <DropdownSelect<string> label="Timeframe" value={desk.opensOn.timeframe ?? ''} options={OPENS_ON_TIMEFRAMES} onChange={v => setDeskPrefs({ opensOn: { timeframe: (v || null) as Timeframe | null } })} title="The timeframe every chart opens on" testId="settings-opens-timeframe" align="end" />
            </Row>
            <Row name="Alerts out loud" line="The jingle when one is set, the chime when it alerts" testId="alerts-sound">
              <Door onClick={chime} title="Hear the chime" testId="chime-try">
                <Volume2 className="w-3 h-3" /> Try it
              </Door>
              <Switch.Root
                checked={desk.alertsSound}
                onCheckedChange={v => setDeskPrefs({ alertsSound: v })}
                aria-label="Alerts out loud"
                className="relative shrink-0 w-8 h-[18px] rounded-full border border-borderSubtle bg-ink/[0.06] data-[state=checked]:bg-silver data-[state=checked]:border-silver transition-colors outline-none focus-visible:ring-2 focus-visible:ring-silver/60"
                data-settings-switch="alerts-sound"
              >
                <Switch.Thumb className="block w-3 h-3 rounded-full bg-textPrimary translate-x-[2px] data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-panel transition-transform" />
              </Switch.Root>
            </Row>
            <Row name="Clock" line="New York's time or your own on every chart's axis and crosshair" testId="clock">
              <DropdownSelect<ClockZone> label="Clock" value={desk.clock} options={CLOCK_OPTIONS} onChange={v => setDeskPrefs({ clock: v })} title="Whose clock the axes keep" testId="settings-clock" align="end" />
            </Row>
          </Section>
          )}

          {/* KEYBOARD */}
          {current === 'keyboard' && (
          <Section id="keyboard" title="Keyboard" line="Every key the terminal answers to, by where it works">
            {KEY_GROUPS.map(g => (
              <Fragment key={g.where}>
                {/* THE GROUP'S NAME — a whisper head over its rows, the house's section label */}
                <div className="px-5 pt-3 pb-1.5 border-t border-borderSubtle/60 font-mono text-[9px] leading-[13px] uppercase tracking-widest text-textMuted" data-settings-key-group={g.where}>
                  {g.where}
                </div>
                {g.keys.map(s => (
                  <div key={s.does} className="px-5 py-2.5 border-t border-borderSubtle/60 flex items-center justify-between gap-6" data-settings-key>
                    <span className="text-[12px] text-textSecondary">{s.does}</span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      {s.keys.map((k, i) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-textMuted">{s.alt ? '/' : '+'}</span>}
                          <Key>{k}</Key>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </Fragment>
            ))}
          </Section>
          )}

          {/* THE LAUNCH PAGES, on the seam */}
          {current === 'account' && <AccountBox />}
          {current === 'people' && (
            <Suspense fallback={<div className="min-h-[360px]" aria-busy="true" />}>
              <PeopleBox />
            </Suspense>
          )}
          {current === 'billing' && <BillingBox />}
          {current === 'data' && <DataBox />}
          {current === 'about' && <AboutBox />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
};

export default Settings;
