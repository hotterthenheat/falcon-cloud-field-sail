import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { MarketDataProvider } from './context/MarketDataContext';
import { TrackerProvider } from './context/TrackerContext';
import { WatchProvider } from './context/WatchContext';
import { LaunchProvider } from './components/layout/LaunchTransition';
import { FocusProvider } from './context/FocusContext';
import EmbedBridge from './components/layout/EmbedBridge';
import PageMeta from './components/layout/PageMeta';
import { EMBEDDED } from './embed';
import { FaviconFollowsMark } from './brand/favicon';
import Wordmark from './brand/Wordmark';

/* Every page is its own chunk, and so is the terminal's shell: the landing and the site pages never load it. */
const loadShell = () => import('./components/layout/AppShell');
const AppShell = lazy(loadShell);
const Landing = lazy(() => import('./pages/landing/Landing'));
const NotFoundInside = lazy(() => import('./pages/notFound/NotFound').then(m => ({ default: m.NotFoundInside })));
const NotFoundPrompt = lazy(() => import('./pages/notFound/NotFound').then(m => ({ default: m.NotFoundPrompt })));
const PulseProduct = lazy(() => import('./pages/landing/products/PulsePage'));
const SignInPage = lazy(() => import('./pages/signin/SignIn'));
const CheckoutPage = lazy(() => import('./pages/checkout/Checkout'));
const TermsPage = lazy(() => import('./pages/landing/legal/Terms'));
const PrivacyPage = lazy(() => import('./pages/landing/legal/Privacy'));
const DossierProduct = lazy(() => import('./pages/landing/products/DossierPage'));
const PinpointProduct = lazy(() => import('./pages/landing/products/PinpointPage'));
const TraceProduct = lazy(() => import('./pages/landing/products/TracePage'));
const WeigherProduct = lazy(() => import('./pages/landing/products/WeigherPage'));
const CompassProduct = lazy(() => import('./pages/landing/products/CompassPage'));
const TerrainProduct = lazy(() => import('./pages/landing/products/TerrainPage'));
const PracticeProduct = lazy(() => import('./pages/landing/products/PracticePages').then(m => ({ default: m.PracticePage })));
const PaperProduct = lazy(() => import('./pages/landing/products/PracticePages').then(m => ({ default: m.PaperPage })));
const BacktestProduct = lazy(() => import('./pages/landing/products/PracticePages').then(m => ({ default: m.BacktestPage })));
const JournalProduct = lazy(() => import('./pages/landing/products/PracticePages').then(m => ({ default: m.JournalPage })));
const Pulse = lazy(() => import('./pages/workspace/Pulse'));
const Terrain = lazy(() => import('./pages/terrain/Terrain'));
const TerrainShare = lazy(() => import('./pages/terrain/TerrainShare'));
const CompassLayout = lazy(() => import('./pages/compass/CompassLayout'));
const CompassBoard = lazy(() => import('./pages/compass/Board'));
const CompassSetup = lazy(() => import('./pages/compass/SetupPage'));
const Blotter = lazy(() => import('./pages/compass/Blotter'));
const Weigher = lazy(() => import('./pages/Weigher'));
const Stocks = lazy(() => import('./pages/record/Stocks'));
const News = lazy(() => import('./pages/record/News'));
const Earnings = lazy(() => import('./pages/record/Earnings'));
const EarningsName = lazy(() => import('./pages/record/EarningsName'));
const StockName = lazy(() => import('./pages/record/StockName'));
const RecordLayout = lazy(() => import('./pages/record/RecordLayout'));
const PracticeLayout = lazy(() => import('./pages/practice/PracticeLayout'));
const PaperDesk = lazy(() => import('./pages/paper/Desk'));
const ReviewSessions = lazy(() => import('./pages/review/Sessions'));
const ReviewDesk = lazy(() => import('./pages/review/Desk'));
const ReviewReport = lazy(() => import('./pages/review/Report'));
const PracticeJournal = lazy(() => import('./pages/practice/Journal'));
const PracticeJournalTrade = lazy(() => import('./pages/practice/JournalTrade'));

const Moved = ({ to }: { to: (params: Record<string, string | undefined>, search: string) => string }) => {
  const params = useParams();
  const { search } = useLocation();
  return <Navigate to={to(params, search)} replace />;
};
const withBook = (search: string): string => {
  const q = new URLSearchParams(search);
  q.set('book', 'backtest');
  return `?${q.toString()}`;
};
const Insiders = lazy(() => import('./pages/record/Insiders'));
const InsiderFile = lazy(() => import('./pages/record/Insiders').then(m => ({ default: m.InsiderFile })));
const Congress = lazy(() => import('./pages/record/Congress'));
const Institutions = lazy(() => import('./pages/record/FilePages').then(m => ({ default: m.Institutions })));
const Shorts = lazy(() => import('./pages/record/FilePages').then(m => ({ default: m.Shorts })));
const EtfBook = lazy(() => import('./pages/record/FilePages').then(m => ({ default: m.EtfBook })));
const HouseFile = lazy(() => import('./pages/record/BookFile').then(m => ({ default: m.HouseFile })));
const ShortFile = lazy(() => import('./pages/record/BookFile').then(m => ({ default: m.ShortFile })));
const FundFile = lazy(() => import('./pages/record/BookFile').then(m => ({ default: m.FundFile })));
const MemberFile = lazy(() => import('./pages/record/BookFile').then(m => ({ default: m.MemberFile })));

const EarningsRedirect = () => {
  const { ticker } = useParams();
  return <Navigate to={ticker ? `/dossier/earnings/${ticker}` : '/dossier/earnings'} replace />;
};
const Tracker = lazy(() => import('./pages/Tracker'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Start = lazy(() => import('./pages/start/Start'));
const PinpointLayout = lazy(() => import('./pages/pinpoint/PinpointLayout'));
const MapDesk = lazy(() => import('./pages/pinpoint/MapDesk'));
const Agenda = lazy(() => import('./pages/pinpoint/Agenda'));
const Board = lazy(() => import('./pages/pinpoint/Board'));
const Compare = lazy(() => import('./pages/pinpoint/Compare'));
const TraceLayout = lazy(() => import('./pages/trace/TraceLayout'));
const LiveTape = lazy(() => import('./pages/trace/LiveTape'));
const OptionsScreener = lazy(() => import('./pages/trace/OptionsScreener'));
const NetFlow = lazy(() => import('./pages/trace/NetFlow'));
const TraceCompare = lazy(() => import('./pages/trace/Compare'));
const DarkPool = lazy(() => import('./pages/trace/DarkPool'));
const Footprints = lazy(() => import('./pages/trace/Footprints'));
const Watchers = lazy(() => import('./pages/trace/Watchers'));
const TradeWindows = lazy(() => import('./pages/trace/Windows'));
const Odte = lazy(() => import('./pages/trace/Odte'));
const MultiLeg = lazy(() => import('./pages/trace/MultiLeg'));
const FlowTracker = lazy(() => import('./pages/trace/FlowTracker'));
const Room = lazy(() => import('./pages/community/Room'));

/* Fetch the shell's code when a pointer or focus lands on a link into the terminal, before the click. */
const SITE_PATHS = /^\/(?:$|[#?]|welcome|products\/|signin|checkout|terms|privacy)/;
const warmShellOnIntent = (e: Event) => {
  const a = (e.target as Element | null)?.closest?.('a[href]');
  const href = a?.getAttribute('href') ?? '';
  if (href.startsWith('/') && !SITE_PATHS.test(href)) void loadShell();
};
/* The first page's code, for a first load inside the terminal (same specifiers as the lazy routes above). */
const FIRST_PAGE: [RegExp, () => Promise<unknown>][] = [
  [/^\/pulse\/?$/, () => import('./pages/workspace/Pulse')],
  [/^\/terrain\/?$/, () => import('./pages/terrain/Terrain')],
  [/^\/trace(\/|$)/, () => import('./pages/trace/TraceLayout')],
  [/^\/trace\/live-tape/, () => import('./pages/trace/LiveTape')],
  [/^\/pinpoint(\/|$)/, () => import('./pages/pinpoint/PinpointLayout')],
  [/^\/pinpoint\/map/, () => import('./pages/pinpoint/MapDesk')],
  [/^\/dossier(\/|$)/, () => import('./pages/record/RecordLayout')],
  [/^\/dossier\/news/, () => import('./pages/record/News')],
  [/^\/compass(\/|$)/, () => import('./pages/compass/CompassLayout')],
  [/^\/practice(\/|$)/, () => import('./pages/practice/PracticeLayout')],
  [/^\/weigher/, () => import('./pages/Weigher')],
  [/^\/settings(\/|$)/, () => import('./pages/settings/Settings')],
  [/^\/start/, () => import('./pages/start/Start')],
];

/* Held while the shell's code arrives: the boot wordmark from index.html, shown only on a wait over 450 ms. */
const ShellWait = () => (
  <div className="min-h-screen bg-canvas flex items-center justify-center" aria-busy="true">
    <span style={{ opacity: 0, animation: 'boot-in 0.01s linear 0.45s forwards' }}>
      <Wordmark height={31} cursor label="" />
    </span>
  </div>
);

if (typeof document !== 'undefined') {
  /* a first load inside the terminal fetches the shell and the page in parallel with the entry's own work */
  const first = window.location.pathname;
  if (!SITE_PATHS.test(first)) {
    void loadShell();
    for (const [re, load] of FIRST_PAGE) if (re.test(first)) void load();
  }
  document.addEventListener('pointerover', warmShellOnIntent, { passive: true });
  document.addEventListener('focusin', warmShellOnIntent);
}

const App = () => {
  return (
    <MotionConfig reducedMotion="user">
      <MarketDataProvider>
        <FocusProvider>
        <TrackerProvider>
        <WatchProvider>
        <LaunchProvider>
        <EmbedBridge />
        {!EMBEDDED && <FaviconFollowsMark />}
        <PageMeta />
        <Suspense fallback={<ShellWait />}>
        <Routes>
          <Route path="/" element={EMBEDDED ? <Navigate to="/pulse" replace /> : <Landing />} />
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/products/pulse" element={EMBEDDED ? <Navigate to="/pulse" replace /> : <PulseProduct />} />
          <Route path="/signin" element={EMBEDDED ? <Navigate to="/" replace /> : <SignInPage />} />
          <Route path="/checkout" element={EMBEDDED ? <Navigate to="/" replace /> : <CheckoutPage />} />
          <Route path="/terms" element={EMBEDDED ? <Navigate to="/" replace /> : <TermsPage />} />
          <Route path="/privacy" element={EMBEDDED ? <Navigate to="/" replace /> : <PrivacyPage />} />
          <Route path="/products/dossier" element={EMBEDDED ? <Navigate to="/dossier/news" replace /> : <DossierProduct />} />
          <Route path="/products/pinpoint" element={EMBEDDED ? <Navigate to="/pinpoint/map" replace /> : <PinpointProduct />} />
          <Route path="/products/trace" element={EMBEDDED ? <Navigate to="/trace/live-tape" replace /> : <TraceProduct />} />
          <Route path="/products/weigher" element={EMBEDDED ? <Navigate to="/weigher" replace /> : <WeigherProduct />} />
          <Route path="/products/compass" element={EMBEDDED ? <Navigate to="/compass" replace /> : <CompassProduct />} />
          <Route path="/products/terrain" element={EMBEDDED ? <Navigate to="/terrain" replace /> : <TerrainProduct />} />
          <Route path="/products/practice" element={EMBEDDED ? <Navigate to="/practice/paper" replace /> : <PracticeProduct />} />
          <Route path="/products/paper" element={EMBEDDED ? <Navigate to="/practice/paper" replace /> : <PaperProduct />} />
          <Route path="/products/backtest" element={EMBEDDED ? <Navigate to="/practice/backtest" replace /> : <BacktestProduct />} />
          <Route path="/products/journal" element={EMBEDDED ? <Navigate to="/practice/journal" replace /> : <JournalProduct />} />
          <Route element={<AppShell />}>
            <Route path="/home" element={<Navigate to="/pulse" replace />} />
            <Route path="/start" element={<Start />} />
            <Route path="/pulse" element={<Pulse />} />
            <Route path="/terrain" element={<Terrain />} />
            <Route path="/terrain/s" element={<TerrainShare />} />
            <Route path="/live-terminal" element={<Navigate to="/pulse" replace />} />
            <Route path="/workspace" element={<Navigate to="/pulse" replace />} />
            <Route path="/compass" element={<CompassLayout />}>
              <Route index element={<CompassBoard />} />
              <Route path="blotter" element={<Blotter />} />
              <Route path="tracker" element={<Tracker embedded />} />
              <Route path=":id" element={<CompassSetup />} />
            </Route>
            <Route path="/weigher" element={<Weigher />} />
            <Route path="/skys-vision" element={<Navigate to="/compass" replace />} />
            <Route path="/practice" element={<PracticeLayout />}>
              <Route index element={<Navigate to="/practice/paper" replace />} />
              <Route path="paper" element={<PaperDesk />} />
              <Route path="backtest" element={<ReviewSessions />} />
              <Route path="futures" element={<ReviewSessions />} />
              <Route path="backtest/:id" element={<ReviewDesk />} />
              <Route path="backtest/:id/report" element={<ReviewReport />} />
              <Route path="journal" element={<PracticeJournal />} />
              <Route path="journal/:sessionId/:tradeId" element={<PracticeJournalTrade />} />
            </Route>
            <Route path="/paper" element={<Navigate to="/practice/paper" replace />} />
            <Route path="/paper/live-chart" element={<Navigate to="/practice/paper" replace />} />
            <Route path="/paper/desk" element={<Navigate to="/practice/paper" replace />} />
            <Route path="/paper/evaluation" element={<Navigate to="/practice/paper" replace />} />
            <Route path="/paper/journal" element={<Moved to={(_, s) => `/practice/journal${s}`} />} />
            <Route path="/paper/journal/:sessionId/:tradeId" element={<Moved to={(p, s) => `/practice/journal/${p.sessionId}/${p.tradeId}${s}`} />} />
            <Route path="/review" element={<Navigate to="/practice/backtest" replace />} />
            <Route path="/review/backtest" element={<Navigate to="/practice/backtest" replace />} />
            <Route path="/review/futures" element={<Navigate to="/practice/futures" replace />} />
            <Route path="/review/backtest/:id" element={<Moved to={p => `/practice/backtest/${p.id}`} />} />
            <Route path="/review/backtest/:id/report" element={<Moved to={p => `/practice/backtest/${p.id}/report`} />} />
            <Route path="/review/journal" element={<Moved to={(_, s) => `/practice/journal${withBook(s)}`} />} />
            <Route path="/review/journal/:sessionId/:tradeId" element={<Moved to={(p, s) => `/practice/journal/${p.sessionId}/${p.tradeId}${withBook(s)}`} />} />
            <Route path="/record" element={<Navigate to="/dossier/news" replace />} />
            <Route path="/record/*" element={<Moved to={(p, s) => `/dossier/${p['*'] ?? ''}${s}`} />} />
            <Route path="/dossier" element={<RecordLayout />}>
              <Route index element={<Navigate to="/dossier/news" replace />} />
              <Route path="news" element={<News />} />
              <Route path="earnings" element={<Earnings />} />
              <Route path="earnings/:ticker" element={<EarningsName />} />
              <Route path="insiders/:person" element={<InsiderFile />} />
              <Route path="insiders" element={<Insiders />} />
              <Route path="congress/:member" element={<MemberFile />} />
              <Route path="congress" element={<Congress />} />
              <Route path="stocks" element={<Stocks />} />
              <Route path="stocks/:ticker" element={<StockName />} />
              <Route path="institutions/:house" element={<HouseFile />} />
              <Route path="institutions" element={<Institutions />} />
              <Route path="shorts/:ticker" element={<ShortFile />} />
              <Route path="shorts" element={<Shorts />} />
              <Route path="etfs/:etf" element={<FundFile />} />
              <Route path="etfs" element={<EtfBook />} />
              <Route path="calendar" element={<Navigate to="/dossier/news#the-day" replace />} />
            </Route>
            <Route path="/stocks" element={<Navigate to="/dossier/stocks" replace />} />
            <Route path="/news" element={<Navigate to="/dossier/news" replace />} />
            <Route path="/newsroom" element={<Navigate to="/dossier/news" replace />} />
            <Route path="/earnings" element={<Navigate to="/dossier/earnings" replace />} />
            <Route path="/earnings/:ticker" element={<EarningsRedirect />} />
            <Route path="/watchlist" element={<Navigate to="/weigher" replace />} />
            <Route path="/tracker" element={<Navigate to="/compass/tracker" replace />} />
            <Route path="/settings/:section?" element={<Settings />} />
            <Route path="/pinpoint" element={<PinpointLayout />}>
              <Route index element={<Navigate to="/pinpoint/map" replace />} />
              <Route path="command" element={<Navigate to="/pulse" replace />} />
              <Route path="flow-map" element={<Navigate to="/pulse" replace />} />
              <Route path="map" element={<MapDesk />} />
              <Route path="ahead" element={<Navigate to="/pinpoint/map" replace />} />
              <Route path="agenda" element={<Agenda />} />
              <Route path="building" element={<Navigate to="/pinpoint/agenda?view=building" replace />} />
              <Route path="wall" element={<Navigate to="/pinpoint/map" replace />} />
              <Route path="targets" element={<Navigate to="/pinpoint/agenda" replace />} />
              <Route path="board" element={<Board />} />
              <Route path="compare" element={<Compare />} />
              <Route path="ranked-targets" element={<Navigate to="/pinpoint/agenda" replace />} />
              {['exposure-profile', 'session', 'history', 'oi-heat', 'strike-profile', 'vanna-charm', 'expiry-ladder', 'greek-surfaces', 'pain-map', 'model-error', 'vol-lab'].map(p => (
                <Route key={p} path={p} element={<Navigate to="/pinpoint/map" replace />} />
              ))}
            </Route>
            <Route path="/trace" element={<TraceLayout />}>
              <Route index element={<Navigate to="/trace/live-tape" replace />} />
              <Route path="live-tape" element={<LiveTape />} />
              <Route path="screener" element={<OptionsScreener />} />
              <Route path="net-flow" element={<NetFlow />} />
              <Route path="footprints" element={<Footprints />} />
              <Route path="watchers" element={<Watchers />} />
              <Route path="flow-alerts" element={<Navigate to="/trace/watchers" replace />} />
              <Route path="intervals" element={<TradeWindows />} />
              <Route path="windows" element={<Navigate to="/trace/intervals" replace />} />
              <Route path="odte" element={<Odte />} />
              <Route path="multi-leg" element={<MultiLeg />} />
              <Route path="compare" element={<TraceCompare />} />
              <Route path="dark-pool" element={<DarkPool />} />
              <Route path="dark-feed" element={<Navigate to="/trace/dark-pool" replace />} />
              <Route path="scanner" element={<Navigate to="/trace/screener" replace />} />
              <Route path="tracker" element={<FlowTracker />} />
              <Route path="futures" element={<Navigate to="/trace/live-tape" replace />} />
            </Route>
            <Route path="/liquidity" element={<Navigate to="/trace" replace />} />
            <Route path="/flow-desk/*" element={<Navigate to="/trace" replace />} />
            <Route path="/pinpoint-gex/*" element={<Navigate to="/pinpoint" replace />} />
            <Route path="/community" element={<Room />} />
            <Route path="/community/*" element={<Navigate to="/community" replace />} />
            <Route path="/auditor-log" element={<Navigate to="/compass/tracker" replace />} />
            {['/pulse/*', '/terrain/*', '/weigher/*', '/compass/*', '/pinpoint/*', '/trace/*', '/dossier/*', '/practice/*', '/settings/*'].map(p => (
              <Route key={p} path={p} element={<NotFoundInside />} />
            ))}
          </Route>
          <Route path="*" element={<NotFoundPrompt />} />
        </Routes>
        </Suspense>
        </LaunchProvider>
        </WatchProvider>
        </TrackerProvider>
        </FocusProvider>
      </MarketDataProvider>
    </MotionConfig>
  );
};

export default App;
