/* The pieces every Settings page is built from (a box of rows, a row, a door, a tag, a field, the error line), shared with People.tsx. */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MorphingInfinity, useBusy, useWorking } from '../../components/ui/Working';

/** A box of rows: the head, then the rows under hairlines */
export const Section = ({ id, title, line, aside, children }: { id: string; title: string; line: string; aside?: ReactNode; children: ReactNode }) => (
  <section id={id} className="border border-borderSubtle rounded-md bg-panel overflow-clip scroll-mt-5" data-settings-section={id}>
    {/* On a phone the tag goes under the words. */}
    <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-x-6 gap-y-2 max-sm:flex-col">
      <div className="min-w-0">
        <h2 className="text-t15 font-semibold leading-tight text-textPrimary">{title}</h2>
        <p className="mt-0.5 text-t11 text-textMuted">{line}</p>
      </div>
      {aside && <div className="shrink-0 pt-0.5">{aside}</div>}
    </div>
    {children}
  </section>
);

/** One setting: the name and its line at the left, the control at the right */
export const Row = ({ name, line, children, testId }: { name: string; line: string; children?: ReactNode; testId: string }) => (
  /* On a phone the control goes under its words. */
  <div className="px-5 py-3 border-t border-borderSubtle/60 flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3" data-settings-row={testId}>
    <div className="min-w-0">
      <div className="text-t12 text-textPrimary">{name}</div>
      <div className="text-t11 text-textMuted">{line}</div>
    </div>
    <div className="shrink-0 flex items-center gap-2 max-sm:flex-wrap">{children}</div>
  </div>
);

/** A door: the house's small bordered button, a link when it has somewhere to go */
/* A door whose handler returns a promise stays busy until it settles (ui/Working.tsx), the mark appearing if that lasts. */
export const Door = ({ children, onClick, to, href, title, tone = 'plain', testId, disabled = false }: { children: ReactNode; onClick?: () => void | Promise<unknown>; to?: string; href?: string; title?: string; tone?: 'plain' | 'bear' | 'silver'; testId: string; disabled?: boolean }) => {
  const [busy, run] = useBusy();
  const working = useWorking(busy);
  const cls = `inline-flex items-center gap-1.5 h-7 max-sm:h-10 px-2.5 rounded-md border font-mono text-t10 uppercase tracking-wider transition-colors whitespace-nowrap ${
    tone === 'bear' ? 'border-bear/40 text-bear hover:bg-bear/10' : tone === 'silver' ? 'border-silver/50 bg-silver/[0.08] text-silver hover:bg-silver/[0.14]' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted'
  }`;
  if (to)
    return (
      <Link to={to} className={cls} title={title} data-settings-door={testId}>
        {children}
      </Link>
    );
  if (href)
    return (
      <a href={href} className={cls} title={title} data-settings-door={testId}>
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick ? () => run(onClick) : undefined} disabled={busy || disabled} aria-busy={busy || undefined} className={`${cls} disabled:cursor-progress disabled:opacity-50`} title={title} data-settings-door={testId}>
      {children}
      {working && <MorphingInfinity viewBox="4 4 16 16" className="w-3 h-3" />}
    </button>
  );
};

/** A small mono word in a pill — a state, never a control */
export const Tag = ({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'silver' }) => (
  <span className={`font-mono text-t9 uppercase tracking-widest rounded px-2 py-0.5 whitespace-nowrap border ${tone === 'silver' ? 'bg-silverFill border-silverFill text-onfoil' : 'border-borderSubtle text-textMuted'}`}>
    {children}
  </span>
);

/** A text field in a row — the chip ground; saves on blur or Enter, Esc puts the value back */
/* A field says why it did not save: `check` returns the reason or null; the reason shows in the alert ink, the typed value stays, nothing saves until it passes. */
export const Field = ({ value, onSave, prefix, width = 200, type = 'text', testId, check }: { value: string; onSave: (v: string) => void; prefix?: string; width?: number; type?: 'text' | 'email'; testId: string; check?: (v: string) => string | null }) => {
  const [v, setV] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setV(value), [value]);
  const errId = `field-${testId}-problem`;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className={`inline-flex items-center h-7 max-sm:h-10 max-sm:max-w-full rounded-md border bg-chip transition-colors ${problem ? 'border-warn/70' : 'border-borderSubtle focus-within:border-borderMuted'}`} style={{ width }}>
        {prefix && <span className="pl-2 font-mono text-t11 text-textMuted select-none">{prefix}</span>}
        <input
          value={v}
          type={type}
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errId : undefined}
          onChange={e => {
            setV(e.target.value);
            if (problem) setProblem(null);
          }}
          onBlur={() => {
            const next = v.trim();
            if (next === value) return setV(value);
            const why = !next ? 'This cannot be empty' : (check?.(next) ?? null);
            if (why) return setProblem(why);
            onSave(next);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setV(value);
              setProblem(null);
            }
          }}
          className={`min-w-0 flex-1 h-full bg-transparent ${prefix ? 'pl-0.5 pr-2' : 'px-2'} font-mono text-t11 text-textPrimary outline-none`}
          data-settings-field={testId}
        />
      </span>
      {problem && (
        <span id={errId} role="alert" className="font-mono text-t10 text-warn" data-settings-problem={testId}>
          {problem}
        </span>
      )}
    </span>
  );
};

/** What went wrong, in the alert ink — or what happened, in the quiet one */
export const Said = ({ problem, note }: { problem: string | null; note: string | null }) =>
  problem ? (
    <p role="alert" className="font-mono text-t10 text-warn" data-account-problem>
      {problem}
    </p>
  ) : note ? (
    <p className="font-mono text-t10 text-textMuted" data-account-note>
      {note}
    </p>
  ) : null;
