/* The head the help pages wear (Status, Changelog, Report a problem): the house head the Settings and Practice shells
   draw — the icon in its 24 px chip, the name, one line, the facts at the right — so these pages read as the
   terminal's own. */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export const HeadFact = ({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) => (
  <div className="min-w-0">
    <dt className="text-t10 text-textMuted whitespace-nowrap">{label}</dt>
    <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap" data-surface-fact={testId}>
      {children}
    </dd>
  </div>
);

const SurfaceHead = ({ icon: Icon, title, line, facts, testId }: { icon: LucideIcon; title: string; line: string; facts?: ReactNode; testId: string }) => (
  <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell data-surface-shell={testId}>
    <div className="min-w-0 flex-1">
      <div className="h-6 flex items-center gap-2.5" data-shell-page>
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <h1 className="text-t15 font-semibold leading-tight text-textPrimary">{title}</h1>
      </div>
      <p className="mt-0.5 text-t11 text-textMuted">{line}</p>
    </div>
    {facts && (
      <dl className="flex flex-wrap gap-x-6 gap-y-2" data-shell-facts>
        {facts}
      </dl>
    )}
  </header>
);

export default SurfaceHead;
