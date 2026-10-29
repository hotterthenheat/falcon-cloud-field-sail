/* A new paper account: the plain practice sizes (cash is the only limit), a prop firm's options evaluation as its own
   pages state the rules, or the reader's own rules. Every firm plan says where its numbers come from and when they were
   read, and that the firm's own site governs. */

import { useState, type ReactNode } from 'react';
import { ClipboardCheck, ExternalLink, SlidersHorizontal, Wallet } from 'lucide-react';
import { card } from '../review/DeskShell';
import { usd } from '../review/words';
import { PRACTICE_SIZES } from '../../data/paper/engine';
import { CUSTOM_DEFAULTS, FIRM_GOVERNS, PROP_FIRMS, customPlan, planChips, sizeWords, type CustomRules } from '../../data/paper/propFirms';
import type { PaperPlan } from '../../data/paper/rules';
import { dayWords } from '../../data/paper/clock';
import { EMBEDDED } from '../../embed';

const SILVER_FILL = 'rgb(var(--silver-fill))';
const sizeBtn = 'h-10 min-w-0 rounded-md border border-borderSubtle font-mono text-t12 tnum text-textPrimary hover:border-silver/60 hover:bg-silver/[0.06] disabled:opacity-35 disabled:cursor-not-allowed transition-colors';

const Head = ({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <span className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-borderSubtle text-textSecondary" aria-hidden="true">
      {icon}
    </span>
    <h2 className="text-t15 font-semibold text-textPrimary truncate">{title}</h2>
    {children}
  </div>
);

/** "Oct 29, 2026" from an ISO date */
export const asOfWords = (iso: string): string => `${dayWords(iso).split(', ')[1]}, ${iso.slice(0, 4)}`;

interface Props {
  /** null where this tab cannot start one (another tab holds the accounts) */
  onPractice: ((size: number) => void) | null;
  onPlan: ((plan: PaperPlan) => void) | null;
}

const NewAccount = ({ onPractice, onPlan }: Props) => {
  const can = !!onPractice;
  const [own, setOwn] = useState(false);
  return (
    <div className="flex flex-col gap-2.5 min-w-0" data-paper-start>
      {/* THE PLAIN PRACTICE ACCOUNT */}
      <div className={`${card} px-6 py-5 flex flex-col gap-3 max-w-[720px] max-sm:px-4`} data-paper-start-practice>
        <Head icon={<Wallet className="w-4 h-4" />} title="A practice account" />
        <p className="text-t12 leading-relaxed text-textSecondary">Options off the chain beside the chart, with pretend money, filled at each contract’s live ThetaData bid and ask during the options session (09:30–16:00 ET). It carries from day to day. Open as many as you like.</p>
        <div className="grid grid-cols-4 max-[420px]:grid-cols-2 gap-1.5 max-w-[440px]">
          {PRACTICE_SIZES.map(size => (
            <button key={size} type="button" disabled={!can} onClick={() => onPractice?.(size)} className={sizeBtn} data-paper-start-size={size}>
              {usd(size, 0)}
            </button>
          ))}
        </div>
        {/* in the landing's window nothing trades (data/paper/store.ts: never EMBEDDED) — say that, not "another tab" */}
        <p className="text-t10 text-textMuted">{can ? 'Pick what it starts with.' : EMBEDDED ? 'Open the terminal to start one — nothing trades from this window.' : 'The accounts are open in another tab — take them here first.'}</p>
      </div>

      {/* THE PROP FIRMS */}
      <div className={`${card} px-6 py-5 flex flex-col gap-4 max-sm:px-4`} data-paper-start-prop>
        <Head icon={<ClipboardCheck className="w-4 h-4" />} title="Prop firm" />
        <p className="text-t12 leading-relaxed text-textSecondary">
          Practise a firm’s options evaluation on live prices before you pay for one: its target, its loss limits, its flat-by time and its other rules are checked on every order and every tick, and the account passes or fails the way the firm’s would. Options only.
        </p>
        {PROP_FIRMS.length === 0 ? (
          <p className="text-t11 text-textMuted" data-paper-firms-empty>
            No firm is listed yet.
          </p>
        ) : (
          PROP_FIRMS.map(f => {
            const programs = [...new Set(f.plans.map(p => p.program ?? ''))];
            return (
              <section key={f.id} className="pt-3 border-t border-borderSubtle/70 flex flex-col gap-3 min-w-0" data-paper-firm={f.id}>
                <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap min-w-0">
                  <h3 className="text-t13 font-semibold text-textPrimary">{f.name}</h3>
                  <span className="font-mono text-t10 text-textMuted whitespace-nowrap">rules as of {asOfWords(f.asOf)}</span>
                  <a href={f.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-t10 text-textSecondary hover:text-textPrimary underline-offset-2 hover:underline tap-40 min-w-0 truncate" data-paper-firm-source>
                    {f.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
                {f.about && <p className="-mt-1.5 text-t11 text-textMuted leading-snug">{f.about}</p>}
                {programs.map(prog => {
                  const plans = f.plans.filter(p => (p.program ?? '') === prog);
                  const first = plans[0];
                  return (
                    <div key={prog} className="flex flex-col gap-2 min-w-0" data-paper-program={`${f.id}:${prog}`}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-t12 font-medium text-textPrimary">{prog}</span>
                        <span className="text-t10 text-textMuted">{planChips(first).join(' · ')}</span>
                      </div>
                      {first.notModelled?.length ? (
                        <p className="text-t10 text-warn leading-snug" data-paper-not-modelled>
                          Not modelled here: {first.notModelled.join(' · ')}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        {plans.map(p => (
                          <button key={p.id} type="button" disabled={!onPlan} onClick={() => onPlan?.(p)} title={`${f.name} · ${prog} · ${sizeWords(p.size)} — ${planChips(p).join(' · ')}`} className={`${sizeBtn} h-9 px-3 text-t11`} data-paper-start-plan={p.id}>
                            {sizeWords(p.size)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })
        )}
        <p className="text-t10 leading-snug text-textMuted" data-paper-firm-governs>
          {FIRM_GOVERNS} This is practice with real prices, not an evaluation: nothing here is affiliated with a firm or reaches one.
        </p>
        {/* THE READER'S OWN RULES */}
        <div className="pt-3 border-t border-borderSubtle/70">
          <button type="button" onClick={() => setOwn(!own)} aria-expanded={own} className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-paper-own-door>
            <SlidersHorizontal className="w-3.5 h-3.5" /> Your own rules
          </button>
          {own && <OwnRules onStart={onPlan} />}
        </div>
      </div>
    </div>
  );
};

/* ---- the reader's own rules: numbers typed in, 0 is a rule left off ---- */
const field = 'h-8 w-full min-w-0 px-2 rounded-md border border-borderSubtle bg-panel font-mono text-t12 tnum text-textPrimary outline-none focus:border-silver/60';
const NumField = ({ label, value, onChange, hint, testId }: { label: string; value: number; onChange: (n: number) => void; hint?: string; testId: string }) => (
  <label className="flex flex-col gap-1 min-w-0" title={hint}>
    <span className="text-t10 text-textMuted whitespace-nowrap truncate">{label}</span>
    <input value={value || ''} placeholder="off" inputMode="numeric" onChange={e => onChange(Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0))} className={field} data-paper-own={testId} />
  </label>
);
const Choice = <T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId: string }) => (
  <label className="flex flex-col gap-1 min-w-0">
    <span className="text-t10 text-textMuted whitespace-nowrap truncate">{label}</span>
    <select value={value} onChange={e => onChange(e.target.value as T)} className={field} data-paper-own={testId}>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);
const OwnRules = ({ onStart }: { onStart: ((plan: PaperPlan) => void) | null }) => {
  const [c, setC] = useState<CustomRules>(CUSTOM_DEFAULTS);
  const set = (p: Partial<CustomRules>) => setC(x => ({ ...x, ...p }));
  const plan = customPlan(c);
  return (
    <div className="mt-3 flex flex-col gap-3" data-paper-own-rules>
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-x-3 gap-y-2.5">
        <NumField label="Starts with ($)" value={c.size} onChange={n => set({ size: Math.max(1000, n) })} testId="size" />
        <NumField label="Profit target ($)" value={c.target} onChange={n => set({ target: n })} hint="Passes at a day’s close at or over the start plus this" testId="target" />
        <NumField label="Daily loss ($)" value={c.dailyLoss} onChange={n => set({ dailyLoss: n })} hint="From the day’s start balance, measured on what the account is worth" testId="daily" />
        <Choice label="At the daily loss" value={c.dailyBreach} options={[{ value: 'fail', label: 'it fails' }, { value: 'pause', label: 'the day is over' }]} onChange={v => set({ dailyBreach: v })} testId="breach" />
        <NumField label="Max drawdown ($)" value={c.drawdown} onChange={n => set({ drawdown: n })} testId="drawdown" />
        <Choice label="The floor" value={c.drawdownMode} options={[{ value: 'static', label: 'fixed at the start' }, { value: 'eod', label: 'trails the best close' }, { value: 'intraday', label: 'trails the best moment' }]} onChange={v => set({ drawdownMode: v })} testId="mode" />
        <NumField label="Min trading days" value={c.minDays} onChange={n => set({ minDays: Math.round(n) })} testId="days" />
        <NumField label="Best day, % of profit" value={c.consistencyPct} onChange={n => set({ consistencyPct: Math.min(100, n) })} testId="consistency" />
        <NumField label="Contracts at once" value={c.maxContracts} onChange={n => set({ maxContracts: Math.round(n) })} testId="contracts" />
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-t10 text-textMuted whitespace-nowrap truncate">Flat by (ET)</span>
          <input value={c.flatBy} placeholder="off — e.g. 15:55" onChange={e => set({ flatBy: e.target.value.replace(/[^0-9:]/g, '').slice(0, 5) })} className={field} data-paper-own="flat" />
        </label>
        <Choice label="Overnight" value={c.overnight ? 'yes' : 'no'} options={[{ value: 'yes', label: 'may hold' }, { value: 'no', label: 'flat by the close' }]} onChange={v => set({ overnight: v === 'yes' })} testId="overnight" />
        <Choice label="0DTE" value={c.zeroDte ? 'yes' : 'no'} options={[{ value: 'yes', label: 'allowed' }, { value: 'no', label: 'not allowed' }]} onChange={v => set({ zeroDte: v === 'yes' })} testId="zerodte" />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-t11 text-textMuted min-w-0">{planChips(plan).join(' · ') || 'No rules set — that is a plain practice account'}</span>
        <button type="button" disabled={!onStart} onClick={() => onStart?.(plan)} className="ml-auto h-8 px-4 rounded-full text-t12 font-semibold disabled:opacity-35 transition-opacity hover:opacity-90" style={{ background: SILVER_FILL, color: '#0a0a0a' }} data-paper-own-start>
          Start it
        </button>
      </div>
    </div>
  );
};

export default NewAccount;
