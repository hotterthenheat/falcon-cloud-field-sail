/* THE "?" SHEET: a short guide to the page in view, the keyboard shortcuts (the same list Settings › Keyboard prints,
   data/shortcuts.ts — only keys a handler answers), and the doors to Status, the Changelog, Notifications and Report a
   problem. Opened by "?" anywhere (not while typing in a field) and from the menu, the palette and the footer. */

import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Bug, CircleHelp, Inbox, Keyboard, ScrollText, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../shadcn/sheet';
import { useLayeredEscape } from '../shadcn/layer';
import { Button } from '../shadcn/button';
import { closeHelp, openNotices, useHelpOpen } from '../../data/overlayDoors';
import { KEY_GROUPS } from '../../data/shortcuts';
import { guideFor } from '../../data/pageGuides';

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex items-center h-5 px-1.5 rounded border border-borderSubtle bg-chip font-mono text-t10 text-textSecondary">{children}</kbd>
);

const Door = ({ to, icon: Icon, label, line, onClick }: { to?: string; icon: typeof Activity; label: string; line: string; onClick?: () => void }) => {
  const inner = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0 text-textMuted" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex flex-col">
        <span className="text-t12 text-textPrimary">{label}</span>
        <span className="text-t10 text-textMuted">{line}</span>
      </span>
    </>
  );
  const cls = 'flex items-center gap-2.5 min-h-[44px] px-2.5 py-1.5 rounded-md border border-borderSubtle/80 bg-ink/[0.02] hover:border-borderMuted hover:bg-ink/[0.04] transition-colors text-left';
  return to ? (
    <Link to={to} onClick={closeHelp} className={cls} data-help-door={to}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} data-help-door={label}>
      {inner}
    </button>
  );
};

const HelpSheet = () => {
  const open = useHelpOpen();
  const { pathname } = useLocation();
  const onEscapeKeyDown = useLayeredEscape(open, closeHelp);
  const guide = guideFor(pathname);
  /* the page in view's keys first, then everywhere, then the rest */
  const groups = [...KEY_GROUPS].sort((a, b) => {
    const score = (g: (typeof KEY_GROUPS)[number]) => (g.page && pathname.startsWith(g.page) ? 0 : g.where === 'Everywhere' ? 1 : 2);
    return score(a) - score(b);
  });
  return (
    <Sheet open={open} onOpenChange={next => !next && closeHelp()}>
      <SheetContent onEscapeKeyDown={onEscapeKeyDown} className="w-[440px]" data-help-sheet>
        <div className="h-12 shrink-0 flex items-center gap-2.5 px-3.5 border-b border-borderSubtle/70">
          <span className="w-6 h-6 rounded-md border border-borderSubtle bg-ink/[0.03] flex items-center justify-center shrink-0" aria-hidden>
            <CircleHelp className="w-3.5 h-3.5 text-textSecondary" strokeWidth={1.75} />
          </span>
          <SheetTitle>Help</SheetTitle>
          <SheetDescription>Press ? to open or close</SheetDescription>
          <Button variant="ghost" size="icon" onClick={closeHelp} aria-label="Close the help" title="Close (Esc)" className="ml-auto" data-help-close>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pb-4" data-help-body>
          {guide && (
            <section className="px-3.5 pt-4" aria-labelledby="help-guide" data-help-guide={guide.path}>
              <h2 id="help-guide" className="font-mono text-t9 uppercase tracking-widest text-textMuted">
                This page · {guide.name}
              </h2>
              <p className="mt-1.5 text-t12 leading-relaxed text-textPrimary">{guide.line}</p>
              {guide.tips.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 list-disc pl-4 marker:text-textMuted">
                  {guide.tips.map(t => (
                    <li key={t} className="text-t11 leading-relaxed text-textSecondary">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="px-3.5 pt-5" aria-labelledby="help-keys">
            <div className="flex items-center gap-2">
              <Keyboard className="w-3.5 h-3.5 text-textMuted" strokeWidth={1.75} aria-hidden />
              <h2 id="help-keys" className="text-t12 font-semibold text-textPrimary">
                Keyboard shortcuts
              </h2>
              <Link to="/settings/keyboard" onClick={closeHelp} className="ml-auto font-mono text-t9 uppercase tracking-wider text-textSecondary hover:text-textPrimary underline decoration-borderMuted underline-offset-4">
                In Settings
              </Link>
            </div>
            <div className="mt-2 rounded-md border border-borderSubtle/80 overflow-hidden">
              {groups.map((g, gi) => (
                <Fragment key={g.where}>
                  <h3 className={`px-3 pt-2.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted ${gi ? 'border-t border-borderSubtle/60' : ''}`} data-help-key-group={g.where}>
                    {g.where}
                  </h3>
                  <dl>
                    {g.keys.map(s => (
                      <div key={s.does} className="px-3 py-1.5 flex items-start justify-between gap-4" data-help-key>
                        {/* the keys are the term, the words its meaning; drawn words first, keys at the right */}
                        <dt className="order-2 inline-flex items-center gap-1 shrink-0">
                          <span className="sr-only">{s.keys.join(s.alt ? ' or ' : ' plus ')}</span>
                          <span className="inline-flex items-center gap-1" aria-hidden>
                            {s.keys.map((k, i) => (
                              <span key={k} className="inline-flex items-center gap-1">
                                {i > 0 && <span className="text-t10 text-textMuted">{s.alt ? '/' : '+'}</span>}
                                <Key>{k}</Key>
                              </span>
                            ))}
                          </span>
                        </dt>
                        <dd className="order-1 text-t11 leading-snug text-textSecondary">{s.does}</dd>
                      </div>
                    ))}
                  </dl>
                </Fragment>
              ))}
            </div>
          </section>

          <section className="px-3.5 pt-5" aria-labelledby="help-more">
            <h2 id="help-more" className="text-t12 font-semibold text-textPrimary">
              More help
            </h2>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Door to="/status" icon={Activity} label="Status" line="Is the data answering?" />
              <Door to="/changelog" icon={ScrollText} label="Changelog" line="What changed lately" />
              <Door
                icon={Inbox}
                label="Notifications"
                line="Alerts, calls and fills"
                onClick={() => {
                  closeHelp();
                  openNotices();
                }}
              />
              <Door to={`/report?from=${encodeURIComponent(pathname)}`} icon={Bug} label="Report a problem" line="With the details attached" />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default HelpSheet;
