/* REPORT A PROBLEM: what happened, what was expected, the steps — and, unless the reader unticks it, the details that
   help find it (data/diagnostics.ts): the page, the name, the build, the theme, the window, the last console errors and
   a snapshot of the data paths. The reader sees all of it before it leaves, and it leaves only by their hand: copied,
   or downloaded as .json. The app has no feedback endpoint, so nothing is sent anywhere. Never collected: a
   credential, a key, a payment detail, storage, the account's email; every string is scrubbed of secret shapes. */

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bug, Check, ClipboardCopy, Download, ShieldCheck } from 'lucide-react';
import SurfaceHead, { HeadFact } from '../../components/help/SurfaceHead';
import { useHealthRows } from '../../components/help/useHealthRows';
import { Button } from '../../components/shadcn/button';
import { Checkbox } from '../../components/shadcn/checkbox';
import { Alert, AlertDescription, AlertTitle } from '../../components/shadcn/alert';
import { useTicker } from '../../context/MarketDataContext';
import { useResolvedTheme, useThemeChoice } from '../../theme/theme';
import { APP_VERSION } from '../../data/appVersion';
import { LATEST_CHANGE } from '../../data/changelog';
import { STATE_WORDS } from '../../data/statusModel';
import { buildReport, recentErrors, reportText, type BugReport, type ReportEnv, type ReportWords } from '../../data/diagnostics';

const FIELD = 'w-full rounded-md border border-borderSubtle bg-chip px-2.5 py-2 text-t12 leading-relaxed text-textPrimary placeholder:text-textMuted transition-colors hover:border-borderMuted focus:outline-none focus:border-silver/50 aria-[invalid=true]:border-warn/70';

/** The page the reader came from: ?from=, else the last page this tab showed (AppShell keeps it), else this one */
const cameFrom = (param: string | null): string => {
  if (param && param.startsWith('/') && !param.startsWith('//')) return param.split(/[?#]/)[0];
  try {
    const kept = sessionStorage.getItem('slayer.lastPage');
    if (kept && kept.startsWith('/') && !kept.startsWith('/report')) return kept.split(/[?#]/)[0];
  } catch {
    /* no storage */
  }
  return '/report';
};

const Labelled = ({ id, label, hint, required, error, children }: { id: string; label: string; hint: string; required?: boolean; error?: string | null; children: ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-t12 font-medium text-textPrimary">
      {label}
      {required ? <span className="text-textMuted font-normal"> · needed</span> : <span className="text-textMuted font-normal"> · if you can</span>}
    </label>
    <p id={`${id}-hint`} className="text-t11 text-textMuted">
      {hint}
    </p>
    {children}
    {error && (
      <p id={`${id}-error`} role="alert" className="font-mono text-t10 text-warn">
        {error}
      </p>
    )}
  </div>
);

const Report = () => {
  const [params] = useSearchParams();
  const [from] = useState(() => cameFrom(params.get('from')));
  const { activeTicker } = useTicker();
  const theme = useResolvedTheme();
  const themeChoice = useThemeChoice();
  const health = useHealthRows(false);
  const ids = { happened: useId(), expected: useId(), steps: useId(), attach: useId() };
  const [words, setWords] = useState<ReportWords>({ happened: '', expected: '', steps: '' });
  const [attach, setAttach] = useState(true);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const missing = !words.happened.trim();

  const env: ReportEnv = useMemo(
    () => ({
      page: from,
      ticker: activeTicker,
      version: APP_VERSION,
      build: LATEST_CHANGE,
      mode: import.meta.env.MODE,
      theme,
      themeChoice,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      browser: navigator.userAgent,
      language: navigator.language,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      online: navigator.onLine !== false,
    }),
    [from, activeTicker, theme, themeChoice],
  );
  const healthRows = health.map(h => ({ id: h.id, label: h.label, state: STATE_WORDS[h.state], line: h.line }));
  const report: BugReport = buildReport(words, attach ? env : null, attach ? recentErrors() : [], attach ? healthRows : []);

  const set = (k: keyof ReportWords) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setWords(w => ({ ...w, [k]: e.target.value }));
    setDone(null);
  };
  const ready = (): boolean => {
    setTried(true);
    return !missing;
  };
  const copy = async () => {
    if (!ready()) return;
    const text = reportText(report);
    try {
      await navigator.clipboard.writeText(text);
      setDone('Copied. Paste it into an email to info@slayerterminal.com or a post in the room.');
    } catch {
      /* no clipboard (an insecure origin, a refused permission): select it for a manual copy */
      setDone('This browser would not copy. Download the file instead, or select the preview below and copy it.');
    }
  };
  const download = () => {
    if (!ready()) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slayer-bug-report-${report.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDone('Downloaded. Attach the file to an email to info@slayerterminal.com.');
  };
  const err = tried && missing ? 'Say what happened — a sentence is enough.' : null;

  return (
    <>
      <SurfaceHead
        icon={Bug}
        title="Report a problem"
        line="What went wrong, with the details that help find it — you see all of it, and nothing is sent"
        testId="report"
        facts={
          <>
            <HeadFact label="Page">{from}</HeadFact>
            <HeadFact label="Name">{activeTicker}</HeadFact>
          </>
        }
      />
      <form
        className="w-full max-w-[860px] grid grid-cols-1 gap-4"
        onSubmit={e => {
          e.preventDefault();
          void copy();
        }}
        noValidate
        data-report
      >
        <section className="border border-borderSubtle rounded-md bg-panel px-5 py-4 flex flex-col gap-4" aria-label="Your words">
          <Labelled id={ids.happened} label="What happened" hint="What you saw, on which page, and when." required error={err}>
            <textarea
              id={ids.happened}
              value={words.happened}
              onChange={set('happened')}
              rows={4}
              required
              aria-required="true"
              aria-invalid={err ? true : undefined}
              aria-describedby={`${ids.happened}-hint${err ? ` ${ids.happened}-error` : ''}`}
              className={FIELD}
              placeholder="The Map showed no walls for SPY after 10:00, though Terrain had them."
              data-report-field="happened"
            />
          </Labelled>
          <Labelled id={ids.expected} label="What you expected" hint="What should have happened instead.">
            <textarea id={ids.expected} value={words.expected} onChange={set('expected')} rows={3} aria-describedby={`${ids.expected}-hint`} className={FIELD} data-report-field="expected" />
          </Labelled>
          <Labelled id={ids.steps} label="Steps to see it again" hint="One per line: where you started, what you pressed.">
            <textarea id={ids.steps} value={words.steps} onChange={set('steps')} rows={4} aria-describedby={`${ids.steps}-hint`} className={FIELD} placeholder={'1. Open Pinpoint → Map\n2. Pick SPY\n3. …'} data-report-field="steps" />
          </Labelled>
          <Alert variant="neutral">
            <ShieldCheck aria-hidden />
            <div className="min-w-0">
              <AlertTitle>Never paste a password, a card number or a key</AlertTitle>
              <AlertDescription>Anything shaped like one is removed from the report before you see it.</AlertDescription>
            </div>
          </Alert>
        </section>

        <section className="border border-borderSubtle rounded-md bg-panel overflow-clip" aria-labelledby="report-diag">
          <div className="px-5 pt-4 pb-3 flex items-start gap-3">
            <Checkbox id={ids.attach} checked={attach} onCheckedChange={v => setAttach(v === true)} className="mt-[3px]" aria-describedby="report-diag-line" data-report-attach />
            <div className="min-w-0">
              <label htmlFor={ids.attach} id="report-diag" className="text-t12 font-medium text-textPrimary cursor-pointer">
                Attach the details
              </label>
              <p id="report-diag-line" className="text-t11 text-textMuted">
                The page, the name, the version, the theme, the window size, the browser, the console’s recent errors ({recentErrors().length} so far) and where the data paths stood. No account, no storage, no keys.
              </p>
            </div>
          </div>
          <details className="border-t border-borderSubtle/60 group" data-report-preview>
            <summary className="px-5 min-h-[40px] flex items-center cursor-pointer font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary">
              See exactly what is in the report
            </summary>
            <pre className="mx-5 mb-4 max-h-[360px] overflow-auto rounded-md border border-borderSubtle bg-inset p-3 font-mono text-t10 leading-relaxed text-textSecondary whitespace-pre-wrap break-words" tabIndex={0} aria-label="The report">
              {reportText(report)}
            </pre>
          </details>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="silver" size="sm" data-report-copy>
            <ClipboardCopy className="w-3 h-3" aria-hidden /> Copy report
          </Button>
          <Button variant="outline" size="sm" onClick={download} data-report-download>
            <Download className="w-3 h-3" aria-hidden /> Download .json
          </Button>
          <Button asChild variant="link" size="none" className="text-t11 min-h-[40px] sm:min-h-0">
            <Link to="/status">See the status page</Link>
          </Button>
        </div>
        <p role="status" aria-live="polite" className="min-h-[18px] font-mono text-t10 text-textMuted" data-report-done>
          {done && (
            <span className="inline-flex items-center gap-1.5">
              <Check className="w-3 h-3 text-silver" aria-hidden />
              {done}
            </span>
          )}
        </p>
      </form>
    </>
  );
};

export default Report;
