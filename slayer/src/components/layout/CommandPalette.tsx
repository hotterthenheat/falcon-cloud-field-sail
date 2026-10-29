import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Working from '../ui/Working';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRightLeft, CornerDownLeft, Crosshair, Users } from 'lucide-react';
import CompanyLogo from '../ui/CompanyLogo';
import { NAV_ITEMS } from './nav';
import { GEX_SUBPAGES } from '../../pages/pinpoint/subnav';
import { TRACE_SUBPAGES } from '../../pages/trace/subnav';
import { RECORD_SUBPAGES } from '../../pages/record/subnav';
import { useMarketData } from '../../context/MarketDataContext';
import Simulator from '../../core/simulator';
import { armDrawTool, canArmDrawTool, searchDrawTools } from '../gex/drawTools';
import { ensureListed, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';
import { sendDeskCmd } from '../../data/terrainCmd';

type TickerModule = typeof import('../../data/tickers');

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface PaletteAction {
  id: string;
  group: 'Navigate' | 'Ticker' | 'Draw' | 'Chart';
  label: string;
  hint: string;
  run: () => void;
  icon?: React.ReactNode;
}

const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const onTerrain = location.pathname === '/terrain' || location.pathname.startsWith('/terrain/');
  const { changeTicker, activeTicker } = useMarketData();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [tickMod, setTickMod] = useState<TickerModule | null>(null);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const room = roomOf();
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* the full ticker universe (S&P 500 + NASDAQ, ~300 KB) loads when the palette first opens */
  useEffect(() => {
    if (!open) return;
    if (!tickMod) import('../../data/tickers').then(setTickMod);
    if (room !== 'listed') ensureListed();
  }, [open, tickMod, room]);

  const actions = useMemo<PaletteAction[]>(() => {
    const nav: PaletteAction[] = NAV_ITEMS.map(item => ({
      id: `nav-${item.path}`,
      group: 'Navigate',
      /* Practice's pages say whose they are ("Practice → Journal"): their names alone could be anything's */
      label: item.group === 'Practice' ? `${item.group} → ${item.label}` : item.label,
      hint: item.description,
      icon: <item.icon className="w-3.5 h-3.5" />,
      run: () => navigate(item.path),
    }));
    const gexSubs: PaletteAction[] = GEX_SUBPAGES.map(page => ({
      id: `nav-${page.path}`,
      group: 'Navigate',
      label: `Pinpoint → ${page.label}`,
      hint: page.subtitle,
      icon: <Crosshair className="w-3.5 h-3.5" />,
      run: () => navigate(page.path),
    }));
    const flowSubs: PaletteAction[] = TRACE_SUBPAGES.map(page => ({
      id: `nav-${page.path}`,
      group: 'Navigate',
      label: `Trace → ${page.label}`,
      hint: page.subtitle,
      icon: <Activity className="w-3.5 h-3.5" />,
      run: () => navigate(page.path),
    }));
    const recordSubs: PaletteAction[] = RECORD_SUBPAGES.map(page => ({
      id: `nav-${page.path}`,
      group: 'Navigate',
      label: `Dossier → ${page.label}`,
      hint: page.subtitle,
      icon: <page.icon className="w-3.5 h-3.5" />,
      run: () => navigate(page.path),
    }));
    /* the Tracker sits under Compass */
    const compassSubs: PaletteAction[] = [
      { id: 'nav-/compass/blotter', group: 'Navigate', label: 'Compass → Blotter', hint: 'Every trade recorded, entry to exit', icon: <Activity className="w-3.5 h-3.5" />, run: () => navigate('/compass/blotter') },
      { id: 'nav-/compass/tracker', group: 'Navigate', label: 'Compass → Tracker', hint: 'The setups you keep, live', icon: <Activity className="w-3.5 h-3.5" />, run: () => navigate('/compass/tracker') },
    ];
    return [...nav, ...gexSubs, ...compassSubs, ...recordSubs, ...flowSubs];
  }, [navigate]);

  // Ticker actions live outside the label filter: with a query they ARE the
  // search (symbol/name matched by searchTickers), resting they list the
  // names the sim already runs.
  const tickerActions = useMemo<PaletteAction[]>(() => {
    const q = query.trim();
    if (q && tickMod) {
      const rows = room === 'listed'
        ? tickMod.searchTickers(q, 8)
        : searchRoom(room, q, 8, tickMod.searchTickers('', 8), companyName);
      return rows.map(t => ({
        id: `ticker-${t.symbol}`,
        group: 'Ticker' as const,
        label: t.name && t.name.toUpperCase() !== t.symbol ? `${t.symbol} · ${t.name}` : t.symbol,
        hint: t.symbol === activeTicker ? 'active' : 'set the name',
        icon: <CompanyLogo ticker={t.symbol} size={14} />,
        run: () => changeTicker(t.symbol),
      }));
    }
    if (tickMod && room !== 'listed') {
      const rows = searchRoom(room, '', 8, tickMod.searchTickers('', 8), companyName);
      return rows.map(t => ({
        id: `ticker-${t.symbol}`,
        group: 'Ticker' as const,
        label: t.name && t.name.toUpperCase() !== t.symbol ? `${t.symbol} · ${t.name}` : t.symbol,
        hint: t.symbol === activeTicker ? 'active' : '',
        icon: <CompanyLogo ticker={t.symbol} size={14} />,
        run: () => changeTicker(t.symbol),
      }));
    }
    return Object.keys(Simulator.TICKERS).map(tk => ({
      id: `ticker-${tk}`,
      group: 'Ticker' as const,
      label: `Set ticker → ${tk}`,
      hint: tk === activeTicker ? 'active' : 'switch simulation feed',
      icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
      run: () => changeTicker(tk),
    }));
  }, [query, tickMod, changeTicker, activeTicker, room, listedRev, nameRev]);

  useEffect(() => {
    if (!open || !tickMod || room === 'listed') return;
    const rows = searchRoom(room, query.trim(), 8, tickMod.searchTickers('', 8), companyName);
    if (rows.length) askCompanyNames(rows.map(r => r.symbol));
  }, [open, tickMod, room, query, listedRev, nameRev]);

  /* Drawing tools by name ("fib ext", Enter) arm the tool on the chart last hovered (gex/drawTools.tsx); only with a
     query, and only on a page with a chart. */
  const drawActions = useMemo<PaletteAction[]>(() => {
    const q = query.trim();
    if (!open || !q || !canArmDrawTool()) return [];
    return searchDrawTools(q)
      .slice(0, 6)
      .map(t => ({
        id: `draw-${t.tool}`,
        group: 'Draw' as const,
        label: `Draw → ${t.label}`,
        hint: 'take the tool in hand',
        icon: <span className="text-[14px] inline-flex">{t.icon}</span>,
        run: () => {
          armDrawTool(t.tool);
        },
      }));
  }, [query, open]);

  /* Levels and the cone by name, applied to the active pane; only while that desk is the page */
  const chartActions = useMemo<PaletteAction[]>(() => {
    const q = query.trim().toLowerCase();
    if (!open || !onTerrain || !q) return [];
    const rows: PaletteAction[] = [
      { id: 'chart-levels', group: 'Chart', label: 'Levels', hint: 'walls on this pane', icon: <Crosshair className="w-3.5 h-3.5" />, run: () => sendDeskCmd({ op: 'overlay', key: 'levels' }) },
      { id: 'chart-cone', group: 'Chart', label: 'Cone', hint: 'expected move on this pane', icon: <Crosshair className="w-3.5 h-3.5" />, run: () => sendDeskCmd({ op: 'overlay', key: 'cone' }) },
      { id: 'chart-cone-session', group: 'Chart', label: 'Cone · Session', hint: "today's expected move", icon: <Crosshair className="w-3.5 h-3.5" />, run: () => sendDeskCmd({ op: 'horizon', horizon: 'session' }) },
      { id: 'chart-cone-week', group: 'Chart', label: 'Cone · Week', hint: "this week's expected move", icon: <Crosshair className="w-3.5 h-3.5" />, run: () => sendDeskCmd({ op: 'horizon', horizon: 'week' }) },
      { id: 'chart-cone-next', group: 'Chart', label: 'Cone · Next', hint: "the next expiry's expected move", icon: <Crosshair className="w-3.5 h-3.5" />, run: () => sendDeskCmd({ op: 'horizon', horizon: 'next' }) },
    ];
    return rows.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q));
  }, [query, open, onTerrain]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...actions, ...tickerActions];
    return [
      ...actions.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)),
      ...chartActions,
      ...drawActions,
      ...tickerActions,
    ];
  }, [actions, tickerActions, drawActions, chartActions, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      // Focus after the overlay paints
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  if (!open) return null;

  const runAction = (action: PaletteAction | undefined) => {
    if (!action) return;
    action.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAction(filtered[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup: string | null = null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] px-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg border border-borderMuted bg-panel rounded-lg shadow-2xl shadow-black overflow-hidden animate-slide-in">
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or destination…"
            className="w-full bg-transparent pl-4 pr-10 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none border-b border-borderSubtle"
          />
          {/* the names arrive as their own chunk on the first open; typed before they land, the search says it is on its way (ui/Working.tsx) */}
          <Working active={open && !tickMod && query.trim().length > 0} className="absolute right-3.5 top-1/2 -translate-y-1/2" />
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-textMuted">No matches</div>
          )}
          {filtered.map((action, i) => {
            const showGroup = action.group !== lastGroup;
            lastGroup = action.group;
            return (
              <div key={action.id}>
                {showGroup && (
                  <div className="px-4 pt-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-textMuted select-none">
                    {action.group}
                  </div>
                )}
                <button
                  onClick={() => runAction(action)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    i === highlight ? 'bg-ink/[0.05]' : ''
                  }`}
                >
                  <span className={i === highlight ? 'text-select' : 'text-textMuted'}>{action.icon}</span>
                  <span className="text-[13px] text-textPrimary">{action.label}</span>
                  <span className="ml-auto text-[10px] font-mono text-textMuted truncate max-w-[45%]">{action.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-borderSubtle font-mono text-[10px] text-textMuted select-none">
          <span>↑↓ navigate</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" /> select
          </span>
          <span className="ml-auto">esc close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
