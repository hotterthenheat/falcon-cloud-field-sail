/* STATUS: whether each of the terminal's own data paths is answering, and how old its last answer is — live quotes,
   options flow and the dealer book, the Compass engine, the exposure recorder and the app server. Every row is what
   the app itself heard (components/help/useHealthRows.ts, data/statusModel.ts); a path nothing has asked yet says
   "checking", never "up". No vendor is named. */

import { Link } from 'react-router-dom';
import { Activity, Bug, RotateCcw } from 'lucide-react';
import SurfaceHead, { HeadFact } from '../../components/help/SurfaceHead';
import { useHealthRows } from '../../components/help/useHealthRows';
import { Badge } from '../../components/shadcn/badge';
import { Alert, AlertDescription, AlertTitle } from '../../components/shadcn/alert';
import { Button } from '../../components/shadcn/button';
import { overall, STATE_WORDS, type RowState, type StatusRow } from '../../data/statusModel';
import { nyClock } from '../../core/nyTime';
import { useBeat } from '../../components/ui/Freshness';
import { ageWords } from '../../data/freshness';

const BADGE: Record<RowState, 'live' | 'warn' | 'neutral' | 'ghost' | 'bear'> = {
  up: 'live',
  degraded: 'warn',
  down: 'warn',
  refused: 'neutral',
  off: 'neutral',
  checking: 'ghost',
};

const SUMMARY: Record<RowState, { title: string; line: string; tone: 'info' | 'warn' | 'neutral' }> = {
  up: { title: 'Every path is answering', line: 'Live quotes, options flow, Compass and the server all answered recently.', tone: 'info' },
  degraded: { title: 'Something is slow', line: 'A path answers, but late or in part. Pages show its last reading, stamped with its time.', tone: 'warn' },
  down: { title: 'Something is down', line: 'A path is not answering. Pages keep what they last showed and try again on their own.', tone: 'warn' },
  refused: { title: 'Some data is closed to this account', line: 'The server answers, but this account may not read every path. Sign in, or check your plan.', tone: 'neutral' },
  off: { title: 'Every path that runs here is answering', line: 'One or more services do not run on this deployment; their rows say which.', tone: 'neutral' },
  checking: { title: 'Checking', line: 'The first answers are on their way.', tone: 'neutral' },
};

const Row = ({ r }: { r: StatusRow }) => (
  <li className="px-5 py-3.5 border-t border-borderSubtle/60 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-6 gap-y-2" data-status-row={r.id} data-status-state={r.state}>
    <div className="min-w-0">
      <h3 className="text-t12 font-medium text-textPrimary">{r.label}</h3>
      <p className="text-t11 text-textMuted">{r.what}</p>
    </div>
    <div className="min-w-0 flex flex-col gap-1 md:items-start">
      <Badge variant={BADGE[r.state]} caps size="md" className="self-start">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${r.state === 'up' ? 'bg-current' : r.state === 'down' || r.state === 'degraded' ? 'bg-warn' : 'bg-ink/30'}`} />
        {STATE_WORDS[r.state]}
      </Badge>
      <p className="text-t11 leading-relaxed text-textSecondary break-words" data-status-line>
        {r.line}
      </p>
    </div>
  </li>
);

const Status = () => {
  const rows = useHealthRows(true);
  const now = useBeat();
  const worst = overall(rows);
  /* "off" alone is not a problem: the summary says every path that runs here answers */
  const summary = SUMMARY[worst];
  const answering = rows.filter(r => r.state === 'up').length;
  const newest = rows.reduce((m, r) => Math.max(m, r.lastAt), 0);
  return (
    <>
      <SurfaceHead
        icon={Activity}
        title="Status"
        line="Whether each of the terminal’s data paths is answering, and how old its last answer is"
        testId="status"
        facts={
          <>
            <HeadFact label="Answering" testId="answering">
              {answering} of {rows.length}
            </HeadFact>
            <HeadFact label="Last answer" testId="last-answer">
              {newest ? `${ageWords(Math.max(0, now - newest))} ago` : '—'}
            </HeadFact>
            <HeadFact label="Checked" testId="checked">
              every 15 s · {nyClock(now, { zone: true })}
            </HeadFact>
          </>
        }
      />
      <div className="w-full max-w-[1072px] flex flex-col gap-4" data-status>
        <Alert variant={summary.tone} data-status-summary={worst} aria-live="polite">
          <div className="min-w-0">
            <AlertTitle>{summary.title}</AlertTitle>
            <AlertDescription>{summary.line}</AlertDescription>
          </div>
        </Alert>
        <section className="border border-borderSubtle rounded-md bg-panel overflow-clip" aria-labelledby="status-paths">
          <div className="px-5 pt-4 pb-3">
            <h2 id="status-paths" className="text-t15 font-semibold leading-tight text-textPrimary">
              Data paths
            </h2>
            <p className="mt-0.5 text-t11 text-textMuted">What this browser heard from each, the last time it asked. Times are New York’s.</p>
          </div>
          <ul>
            {rows.map(r => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} data-status-reload>
            <RotateCcw className="w-3 h-3" aria-hidden /> Reload the terminal
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/report" data-status-report>
              <Bug className="w-3 h-3" aria-hidden /> Report a problem
            </Link>
          </Button>
          <p className="text-t11 text-textMuted">A page never invents a figure while a path is down: it shows its last reading, stamped “as of”.</p>
        </div>
      </div>
    </>
  );
};

export default Status;
