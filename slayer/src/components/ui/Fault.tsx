/* What a reader sees when a page or the app stops: a stale chunk reloads once (a second time within 30 s asks), offline says so,
   an error offers reload and the way back. RouteBoundary keeps the rail; AppBoundary (main.tsx) uses plain links. */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import SlayerMark from '../../brand/SlayerMark';
import Wordmark from '../../brand/Wordmark';
import BracketCard from '../../brand/BracketCard';

const STALE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i;
/** A chunk requested by a name the server no longer has (a deploy under an open tab), or no network at all */
export const isLoadFault = (error: Error): boolean => STALE.test(`${error.name} ${error.message}`);

const RELOADED_AT = 'slayer_fault_reloaded_at';
let lastHidden = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lastHidden = Date.now();
  });
}
/** Reload once for a stale build. A tab switch is not a stale build, and it does not reload the page. */
export function reloadOnceForStaleBuild(): boolean {
  if (typeof document !== 'undefined' && (document.visibilityState === 'hidden' || Date.now() - lastHidden < 8000)) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface FaultViewProps {
  error: Error;
  /** 'page' sits inside the shell; 'app' is the whole screen */
  scope: 'page' | 'app';
  /** The way back, as the host can offer it (the shell passes a router link; the app's net cannot) */
  back?: ReactNode;
}

export const FaultView = ({ error, scope, back }: FaultViewProps) => {
  const load = isLoadFault(error);
  const offline = load && typeof navigator !== 'undefined' && navigator.onLine === false;
  const head = offline ? 'You are offline' : load ? 'The terminal was updated' : scope === 'app' ? 'The terminal stopped' : 'This page stopped';
  const says = offline
    ? 'This page could not be fetched because there is no connection. Pages you have already opened still work. Try again once you are back online.'
    : load
      ? 'A newer version was published while this tab was open, so this page has to be fetched again. Reload and you are back where you were.'
      : scope === 'app'
        ? 'Something broke and the terminal could not carry on. Reloading usually fixes it. Your board, marks and settings are safe: this machine keeps them, and your account carries them when you are signed in.'
        : 'Something broke on this page and it could not carry on. The rest of the terminal is fine. Reload, or go back to Pulse.';
  /* a page fault fills the room it had: brackets at its corners, words centred at a reading width; the app-wide fault
     keeps its centred card */
  const full = scope === 'page';
  const card = (
    /* the card wears the tile's corners and the mark in the state it reports (loading while a newer build loads, else
       offline) */
    <BracketCard className={full ? 'flex-1 w-full min-h-[60svh] p-8 flex flex-col items-center justify-center text-center gap-3' : 'p-6 sm:p-8 flex flex-col items-center text-center gap-3 max-w-[640px]'} label="fault">
    <div role="alert" className="contents" data-fault={offline ? 'offline' : load ? 'stale' : 'error'} data-fault-scope={scope}>
      <span className="flex items-center gap-3">
        <SlayerMark size={32} bare state={load && !offline ? 'loading' : 'offline'} label="" />
        <span className={`font-mono text-t10 font-bold uppercase tracking-widest ${load ? 'text-textMuted' : 'text-warn'}`}>{load ? 'One moment' : 'A fault'}</span>
      </span>
      <h1 className="text-t20 font-semibold tracking-tight text-textPrimary leading-tight">{head}</h1>
      <p className="max-w-[560px] text-t135 text-textSecondary leading-relaxed">{says}</p>
      <div className="mt-2 flex items-center justify-center gap-2.5 flex-wrap">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-textPrimary text-canvas text-t125 font-medium"
          data-fault-reload
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden /> {offline ? 'Try again' : 'Reload'}
        </button>
        {back}
      </div>
      {!load && (
        <p className="mt-2 max-w-[560px] text-t12 text-textMuted leading-relaxed">
          If it keeps happening, send this line to{' '}
          <a href={`mailto:info@slayerterminal.com?subject=${encodeURIComponent('A fault in the terminal')}&body=${encodeURIComponent(`${error.name}: ${error.message}\n${typeof location !== 'undefined' ? location.href : ''}`)}`} className="text-textSecondary underline decoration-borderMuted underline-offset-4 hover:text-textPrimary">
            info@slayerterminal.com
          </a>
          :
          <code className="mt-1.5 block font-mono text-t11 text-textSecondary break-all select-all" data-fault-line>
            {error.name}: {error.message}
          </code>
        </p>
      )}
    </div>
    </BracketCard>
  );
  if (scope === 'page') return card;
  return (
    <div className="min-h-screen bg-canvas text-textPrimary flex flex-col">
      <header className="shrink-0 h-[64px] flex items-center px-5 sm:px-8">
        <a href="/" className="inline-flex" aria-label="Slayer Terminal, the front page">
          <Wordmark height={14} cursor label="" />
        </a>
      </header>
      <main className="flex-1 flex items-center justify-center px-5 pb-[12vh]">{card}</main>
    </div>
  );
};

/** The net around everything. A stale build reloads itself once; anything else is said, full screen. */
export class AppBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app boundary]', error, info.componentStack);
    if (isLoadFault(error) && navigator.onLine !== false) reloadOnceForStaleBuild();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <FaultView
        error={this.state.error}
        scope="app"
        back={
          <a href="/" className="inline-flex items-center h-9 px-4 rounded-md border border-borderMuted text-t125 font-medium text-textPrimary hover:bg-ink/[0.05]">
            Front page
          </a>
        }
      />
    );
  }
}
