/*
  How to read the Compass board. The decision math is withdrawn: this page does not teach a model, a line, a stop, or an exit.
*/

import type { ReactNode } from 'react';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-t13 font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-t12 leading-relaxed text-textSecondary">{children}</div>
  </section>
);

export const CompassGuide = () => (
  <div data-compass-guide>
    <Section title="Withdrawn">
      <p>The decision math is withdrawn. Compass does not score a contract, does not publish a call, and does not run a stop or an exit. The trees, the line, the runner, the late sweep, and Model Risk are not on this desk. Quotes, the book, and the levels on the other desks are unchanged.</p>
    </Section>
    <Section title="What stays">
      <p>Nothing is scanned for a call. Narrowing the board to a name narrows what you see. With the quotes feed down the board says so. Review can still list a print that ran, and that list is not a model call.</p>
    </Section>
  </div>
);
