/* A plan's rules as they stand: a bar each for the goals (the target, the days) and the limits (the day's loss, the
   floor, the contracts), the figure and the room left beside it, and the holding rules as one line each. The desk's
   rules card shows them all; a row of the Accounts page the three that decide the account. */

import type { RuleRead } from '../../data/paper/rules';

const INK: Record<RuleRead['state'], { bar: string; text: string }> = {
  ok: { bar: 'bg-silver/70', text: 'text-textSecondary' },
  near: { bar: 'bg-warn', text: 'text-warn' },
  met: { bar: 'bg-bull', text: 'text-bull' },
  hit: { bar: 'bg-bear', text: 'text-bear' },
};
/** A goal fills silver toward its end and green at it; a limit fills as it is used, amber near the end, red at it */
const barInk = (r: RuleRead) => (r.kind === 'goal' ? (r.state === 'met' ? INK.met.bar : 'bg-silver/70') : INK[r.state].bar);

export const RuleBar = ({ r, dense = false }: { r: RuleRead; dense?: boolean }) => (
  <div className="min-w-0" title={r.says} data-paper-rule={r.id} data-paper-rule-state={r.state}>
    <div className="flex items-baseline gap-2 min-w-0">
      <span className={`${dense ? 'text-t10' : 'text-t11'} text-textMuted whitespace-nowrap`}>{r.label}</span>
      <span className={`ml-auto font-mono ${dense ? 'text-t10' : 'text-t11'} tnum whitespace-nowrap truncate ${r.state === 'ok' ? 'text-textPrimary' : INK[r.state].text}`}>{r.value}</span>
    </div>
    {r.kind !== 'fact' && (
      <div className="mt-1 h-[4px] rounded-full bg-ink/[0.08] overflow-hidden" aria-hidden="true">
        <span className={`block h-full rounded-full ${barInk(r)}`} style={{ width: `${(Math.max(0.02, r.fill) * 100).toFixed(1)}%` }} />
      </div>
    )}
    {!dense && r.room && <div className="mt-0.5 font-mono text-t10 tnum text-textMuted whitespace-nowrap truncate">{r.room}</div>}
  </div>
);

/** Every rule, two to a row where there is room */
const RuleBars = ({ rules, dense = false, className = '' }: { rules: RuleRead[]; dense?: boolean; className?: string }) => {
  const bars = rules.filter(r => r.kind !== 'fact');
  const facts = rules.filter(r => r.kind === 'fact');
  return (
    <div className={`flex flex-col gap-2.5 ${className}`} data-paper-rules>
      <div className={`grid gap-x-4 gap-y-2.5 ${dense ? 'grid-cols-1' : 'grid-cols-2 max-sm:grid-cols-1'}`}>
        {bars.map(r => (
          <RuleBar key={r.id} r={r} dense={dense} />
        ))}
      </div>
      {facts.length > 0 && (
        <div className="flex flex-col gap-1">
          {facts.map(r => (
            <div key={r.id} className="flex items-baseline gap-2 min-w-0 font-mono text-t10 tnum" title={r.says} data-paper-rule={r.id} data-paper-rule-state={r.state}>
              <span className="text-textMuted whitespace-nowrap">{r.label}</span>
              <span className={`ml-auto truncate ${r.state === 'ok' ? 'text-textSecondary' : INK[r.state].text}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RuleBars;
