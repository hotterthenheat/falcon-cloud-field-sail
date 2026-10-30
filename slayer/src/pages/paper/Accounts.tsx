/* PAPER · the Accounts page (/practice/paper): every paper account side by side — what each is worth, its day, all
   time, where its rules stand — with the ways to open one, rename it, start it over, archive it or end it, delete it,
   and to start a new one. With none yet, the new-account card is the page. */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowRight, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { Fact } from '../../components/trace/TraceBox';
import RenameDoor from '../../components/review/RenameDoor';
import ThetaLine from '../../components/review/ThetaLine';
import { dirInk, usd, usdSigned } from '../../components/review/words';
import NewAccount from '../../components/paper/NewAccount';
import { RuleBar } from '../../components/paper/RuleBars';
import { SellChip, StatusChip, kindWords } from '../../components/paper/AccountCard';
import { HeldElsewhere } from '../../components/paper/HeldElsewhere';
import { viewOf, type PaperAccount } from '../../data/paper/engine';
import { readRules } from '../../data/paper/rules';
import { archiveAccount, deleteAccount, endAccountNow, liveMarket, renameAccount, resetAccount, startPlan, startPractice, usePaper } from '../../data/paper/store';
import { feedOffline, feedRev, subscribeFeed } from '../../data/paper/thetaFeed';
import { nyMomentWords } from '../../data/paper/clock';

const SILVER_FILL = 'rgb(var(--silver-fill))';
const door = 'inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle font-mono text-t10 text-textSecondary hover:text-textPrimary hover:border-borderMuted disabled:opacity-30 disabled:cursor-not-allowed transition-colors tap-40';
const iconDoor = 'inline-flex items-center justify-center w-7 h-7 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors tap-40';

/** The page moves with the feed: a render a beat, and whenever a quote lands */
function useBeat(): number {
  const [n, setN] = useState(0);
  const marks = useSyncExternalStore(subscribeFeed, feedRev, feedRev);
  useEffect(() => {
    const id = window.setInterval(() => setN(x => x + 1), 2_000);
    return () => window.clearInterval(id);
  }, []);
  return n * 100_000 + marks;
}

const Num = ({ label, children, title, testId }: { label: string; children: React.ReactNode; title?: string; testId?: string }) => (
  <div className="min-w-0" title={title}>
    <div className="text-t10 text-textMuted whitespace-nowrap">{label}</div>
    <div className="mt-0.5 font-mono text-t13 tnum text-textPrimary whitespace-nowrap truncate" data-paper-row-fact={testId}>
      {children}
    </div>
  </div>
);

const Row = ({ a, holding, onOpen }: { a: PaperAccount; holding: boolean; onOpen: () => void }) => {
  const navigate = useNavigate();
  const [sure, setSure] = useState<null | 'delete' | 'end' | 'reset'>(null);
  const m = liveMarket();
  const v = viewOf(a, m);
  const rules = readRules(a, v, m).filter(r => r.id === 'target' || r.id === 'daily' || r.id === 'drawdown');
  const live = Number.isFinite(v.equity);
  const open = v.opt.length;
  const working = a.opt.orders.filter(o => o.status === 'working').length;
  const ask = (what: 'delete' | 'end' | 'reset', run: () => void) => () => (sure === what ? (setSure(null), run()) : setSure(what));
  const off = holding ? undefined : 'The accounts are open in another tab — take them here first';
  return (
    <div className="px-5 py-4 max-sm:px-4 border-t border-borderSubtle/70 grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] items-start" data-paper-row={a.id} data-paper-row-status={a.status}>
      {/* who it is */}
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={onOpen} className="min-w-0 text-left text-t13 font-semibold text-textPrimary hover:underline underline-offset-2 truncate" data-paper-row-open-name>
            {a.name}
          </button>
          {holding && <RenameDoor name={a.name} onSave={n => renameAccount(a.id, n)} className="w-6 h-6 shrink-0" />}
          <StatusChip a={a} />
          {!a.plan?.legacy && <SellChip a={a} />}
        </div>
        <p className="text-t11 text-textMuted truncate" title={a.statusWhy}>
          {kindWords(a)}
        </p>
        {a.status !== 'open' && a.statusWhy && <p className={`text-t11 leading-snug ${a.status === 'failed' ? 'text-bear' : a.status === 'passed' ? 'text-bull' : 'text-textSecondary'}`}>{a.statusWhy}{a.statusAt ? ` · ${nyMomentWords(a.statusAt)}` : ''}</p>}
      </div>
      {/* the numbers */}
      <div className="grid grid-cols-4 max-sm:grid-cols-2 gap-x-4 gap-y-2 min-w-0">
        <Num label="Worth" testId="worth">
          {live ? usd(v.equity) : '—'}
        </Num>
        <Num label="Today" testId="today">
          <span className={live ? dirInk(v.today) : 'text-textMuted'}>{live ? usdSigned(v.today) : '—'}</span>
        </Num>
        <Num label="All time" testId="all-time">
          <span className={live ? dirInk(v.allTime) : 'text-textMuted'}>{live ? usdSigned(v.allTime) : '—'}</span>
        </Num>
        <Num label="Open · working" testId="open">
          {open} · {working}
        </Num>
      </div>
      {/* the rules that decide it */}
      <div className="min-w-0 flex flex-col gap-2">
        {rules.length ? rules.map(r => <RuleBar key={r.id} r={r} dense />) : <p className="text-t11 text-textMuted">{a.plan?.legacy ? 'A futures evaluation from before options-only' : 'No rules — cash is the only limit'}</p>}
      </div>
      {/* the doors */}
      <div className="lg:col-span-3 flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-t11 font-semibold transition-opacity hover:opacity-90 tap-40" style={{ background: SILVER_FILL, color: '#0a0a0a' }} data-paper-row-open>
          Open the desk <ArrowRight className="w-3 h-3" />
        </button>
        {!a.plan?.legacy && (
          <button
            type="button"
            disabled={!holding}
            onClick={ask('reset', () => {
              const id = resetAccount(a.id);
              if (id) navigate(`/practice/paper/${id}`);
            })}
            title={off ?? 'Start over: this one is ended and archived (its trades stay in the journal), and a fresh one on the same size and rules opens'}
            className={`${door} ${sure === 'reset' ? 'text-warn border-warn/50' : ''}`}
            data-paper-row-reset={sure === 'reset' ? 'sure' : 'ask'}
          >
            <RotateCcw className="w-3 h-3" /> {sure === 'reset' ? 'Start over — sure' : 'Start over'}
          </button>
        )}
        {a.status === 'open' && (
          <button type="button" disabled={!holding} onClick={ask('end', () => endAccountNow(a.id))} title={off ?? 'End it: everything open is closed at the market, and it is written down as ended — not passed, not failed'} className={`${door} ${sure === 'end' ? 'text-bear border-bear/50' : ''}`} data-paper-row-end={sure === 'end' ? 'sure' : 'ask'}>
            <Square className="w-3 h-3" /> {sure === 'end' ? 'End it — sure' : 'End it'}
          </button>
        )}
        <button type="button" disabled={!holding} onClick={() => archiveAccount(a.id, !a.archived)} title={off ?? (a.archived ? 'Back on the list' : a.status === 'open' ? 'Off the list: it is ended first (nothing trades out of sight), and kept with its trades' : 'Off the list — kept, with its trades')} className={door} data-paper-row-archive={a.archived ? 'restore' : 'archive'}>
          {a.archived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />} {a.archived ? 'Restore' : 'Archive'}
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {sure && (
            <button type="button" onClick={() => setSure(null)} className={iconDoor} aria-label="Not now" title="Not now" data-paper-row-cancel>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" disabled={!holding} onClick={ask('delete', () => deleteAccount(a.id))} title={off ?? 'Delete it for good, with its trades and journal notes'} className={`${door} ${sure === 'delete' ? 'text-bear border-bear/50' : 'hover:!text-bear'}`} data-paper-row-delete={sure === 'delete' ? 'sure' : 'ask'}>
            <Trash2 className="w-3 h-3" /> {sure === 'delete' ? 'Delete for good — sure' : 'Delete'}
          </button>
        </span>
      </div>
    </div>
  );
};

const Accounts = () => {
  const navigate = useNavigate();
  const { accounts, holding, elsewhere } = usePaper();
  useBeat();
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [showArchived, setShowArchived] = useState(false);
  const shown = accounts.filter(a => !a.archived);
  const archived = accounts.filter(a => a.archived);
  const go = (id: string | null) => id && navigate(`/practice/paper/${id}`);
  const onPractice = holding ? (size: number) => go(startPractice(size)) : null;
  const onPlan = holding ? (plan: Parameters<typeof startPlan>[0]) => go(startPlan(plan)) : null;
  const totals = { worth: 0, all: 0 };
  const m = liveMarket();
  for (const a of shown) {
    const v = viewOf(a, m);
    if (Number.isFinite(v.equity)) {
      totals.worth += v.equity;
      totals.all += v.allTime;
    }
  }

  /* none yet: the start card the page has always opened on — the plain sizes, and the prop firms beside them */
  if (!accounts.length) {
    return (
      <div className="flex flex-col gap-2.5" data-paper-accounts="none">
        {!holding && elsewhere && <HeldElsewhere />}
        <NewAccount onPractice={onPractice} onPlan={onPlan} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-paper-accounts={shown.length}>
      {!holding && elsewhere && <HeldElsewhere />}
      <ThetaLine since={feedOffline()} what="ThetaData offline — reconnecting · what each account is worth is as of its last quotes, and nothing fills" />
      <div className="relative border border-borderSubtle rounded-xs overflow-clip bg-panel flex flex-col" data-paper-accounts-box>
        <div className="px-5 max-sm:px-4 pt-4 pb-3 flex items-start flex-wrap gap-x-6 gap-y-3">
          <div className="min-w-[min(16rem,100%)] flex-1">
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary">Your paper accounts</h3>
            <p className="mt-0.5 text-t11 text-textMuted">Each runs on ThetaData’s live NBBO, side by side · a prop-firm account is judged by its firm’s rules on every order and every tick</p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Fact label="Accounts">{shown.length}</Fact>
            <Fact label="Open">{shown.filter(a => a.status === 'open').length}</Fact>
            <Fact label="Worth, all of them">{usd(totals.worth)}</Fact>
            <Fact label="All time">
              <span className={dirInk(totals.all)}>{usdSigned(totals.all)}</span>
            </Fact>
          </dl>
        </div>
        <div className="px-5 max-sm:px-4 pb-3 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setAdding(!adding)} aria-expanded={adding} className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-t11 font-semibold transition-opacity hover:opacity-90 tap-40" style={{ background: SILVER_FILL, color: '#0a0a0a' }} data-paper-new>
            {adding ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />} {adding ? 'Not now' : 'New account'}
          </button>
          {archived.length > 0 && (
            <button type="button" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived} className={`${door} h-8`} data-paper-show-archived>
              <Archive className="w-3 h-3" /> {showArchived ? 'Hide' : 'Show'} archived · {archived.length}
            </button>
          )}
          <Link to="/practice/journal" className={`${door} h-8 ml-auto`}>
            The journal <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {adding && (
          <div className="px-5 max-sm:px-4 pb-4" data-paper-new-card>
            <NewAccount onPractice={onPractice} onPlan={onPlan} />
          </div>
        )}
        {shown.map(a => (
          <Row key={a.id} a={a} holding={holding} onOpen={() => go(a.id)} />
        ))}
        {shown.length === 0 && <p className="px-5 py-6 border-t border-borderSubtle/70 text-t12 text-textMuted">Every account is archived — start a new one, or show the archived ones.</p>}
        {showArchived && archived.length > 0 && (
          <>
            <div className="px-5 max-sm:px-4 pt-4 pb-2 border-t border-borderSubtle font-mono text-t10 uppercase tracking-widest text-textMuted">Archived</div>
            {archived.map(a => (
              <Row key={a.id} a={a} holding={holding} onOpen={() => go(a.id)} />
            ))}
          </>
        )}
      </div>
      <p className="px-1 font-mono text-t10 text-textMuted">ThetaData’s live NBBO — practice, not advice. A firm’s rules are its own site’s; every time is New York’s (ET).</p>
    </div>
  );
};

export default Accounts;
