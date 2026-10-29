/*
==================================================
  SLAYER TERMINAL - THE EDITOR DOCK'S DOOR
  (components/scripts/EditorDockGate.tsx)

  The script editor is CodeMirror, the Pine runtime and
  — through the bars its status line reads — the chart
  itself. The shell mounted the dock on every page, so
  all of that rode in the FIRST file every visitor
  downloads: the landing page on a phone paid for an
  editor it cannot even open (measured 2026-09-19 on a
  production build: the first file was 1,602 KB).

  The shell mounts THIS instead: a few lines that watch
  whether the dock is open, and fetch the editor the
  first time it is. Nothing shows while it travels —
  the dock fades in when it lands, as it always did.

  SCRIPTS ARE PART OF TAPE (2026-10-10, the plan gates):
  on Book the dock opens onto a card instead of the
  editor — what scripts are, which plan has them, and
  the doors to Desk and to Tape — in the dock's own
  place at the chart's right edge.
==================================================
*/

import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Lock, X } from 'lucide-react';
import { closeEditor, useEditorDock } from '../../data/editorDock';
import { useAccess } from '../../data/access';
import { planOf, priceOf } from '../../data/billing';
import { useResolvedTheme } from '../../theme/theme';

const EditorDock = lazy(() => import('./EditorDock'));

/** the dock's place, holding the card instead of the editor */
const ScriptsWall = () => {
  const theme = useResolvedTheme();
  const access = useAccess();
  const holds = access.held ? planOf(access.held) : null;
  const desk = priceOf('desk', 'month');
  const tape = priceOf('tape', 'month');
  const to = (plan: 'desk' | 'tape') => (access.status === 'out' ? `/signin?face=up&next=${encodeURIComponent(`/checkout?plan=${plan}&period=month`)}` : `/checkout?plan=${plan}&period=month`);
  return (
    <aside className="fixed right-0 top-0 bottom-0 z-40 w-[360px] max-w-full border-l border-borderSubtle bg-panel flex flex-col animate-soft-in" data-scripts-wall>
      <header className="flex items-center justify-between gap-3 px-4 h-10 border-b border-borderSubtle shrink-0">
        <span className="inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-wider text-textSecondary">
          <Lock className="w-3 h-3" aria-hidden="true" /> Scripts · Tape
        </span>
        <button type="button" onClick={closeEditor} aria-label="Close" className="inline-flex items-center justify-center w-7 h-7 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-scripts-wall-close>
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      <div className="p-5 flex flex-col gap-4">
        <p className="text-t13 leading-relaxed text-textPrimary">
          Your own scripts on the chart — Pine, written here and drawn on the bars — are part of Tape.{holds ? ` You are on ${holds.name}.` : ''}
        </p>
        <div className="rounded-md border border-silver/40 bg-silver/[0.06] p-3.5" data-scripts-wall-desk>
          <p className="flex items-baseline gap-2">
            <span className="text-t14 font-semibold text-textPrimary">Desk</span>
            <span className="font-mono text-t11 tnum text-textMuted">
              {desk.price} {desk.period}
            </span>
            <span className="ml-auto h-4 px-1.5 inline-flex items-center rounded-full bg-textPrimary text-canvas font-mono text-t8 font-bold uppercase tracking-widest">All of it</span>
          </p>
          <p className="mt-1 text-t12 leading-snug text-textSecondary">Scripts, Trace and Dossier, and Compass, the Weigher, Practice and Community.</p>
          <Link to={to('desk')} className={`mt-3 h-10 w-full rounded-full inline-flex items-center justify-center text-t135 font-medium ${theme === 'dark' ? 'holo-bg text-onfoil' : 'galaxy-bg'}`} data-scripts-wall-go="desk">
            {holds ? 'Upgrade to Desk' : 'Choose Desk'}
          </Link>
        </div>
        <p className="text-t12 leading-relaxed text-textSecondary">
          Or just Tape, {tape.price} {tape.period}:{' '}
          <Link to={to('tape')} className="text-textPrimary hover:underline underline-offset-2" data-scripts-wall-go="tape">
            {holds ? 'upgrade to Tape' : 'choose Tape'}
          </Link>
          .
        </p>
      </div>
    </aside>
  );
};

const EditorDockGate = () => {
  const dock = useEditorDock();
  const access = useAccess();
  if (!dock.open) return null;
  if (access.on && access.status !== 'loading' && !access.can('tape')) return <ScriptsWall />;
  return (
    <Suspense fallback={null}>
      <EditorDock />
    </Suspense>
  );
};

export default EditorDockGate;
