import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Working from '../ui/Working';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRightLeft, Bug, CircleHelp, CornerDownLeft, Crosshair, Inbox, ScrollText } from 'lucide-react';
import { openHelp, openNotices } from '../../data/overlayDoors';
import CompanyLogo from '../ui/CompanyLogo';
import { NAV_ITEMS } from './nav';
import { GEX_SUBPAGES } from '../../pages/pinpoint/subnav';
import { TRACE_SUBPAGES } from '../../pages/trace/subnav';
import { RECORD_SUBPAGES } from '../../pages/record/subnav';
import { useTicker } from '../../context/MarketDataContext';
import { armDrawTool, canArmDrawTool, searchDrawTools } from '../gex/drawTools';
import { ensureListed, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';
import { sendDeskCmd } from '../../data/terrainCmd';
import { Dialog, DialogContent } from '../shadcn/dialog';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '../shadcn/command';

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

/* The names offered before anything is typed */
const QUICK_NAMES = ['SPY', 'QQQ', 'IWM', 'SPX', 'AAPL', 'NVDA'];
const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const onTerrain = location.pathname === '/terrain' || location.pathname.startsWith('/terrain/');
  const { changeTicker, activeTicker } = useTicker();
  const [query, setQuery] = useState('');
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
    /* the help surfaces: two pages, a form and two sheets */
    const help: PaletteAction[] = [
      { id: 'nav-/status', group: 'Navigate', label: 'Status', hint: 'Whether live quotes, options flow, Compass and the server are answering', icon: <Activity className="w-3.5 h-3.5" />, run: () => navigate('/status') },
      { id: 'nav-/changelog', group: 'Navigate', label: 'Changelog', hint: 'What changed in the terminal, newest first', icon: <ScrollText className="w-3.5 h-3.5" />, run: () => navigate('/changelog') },
      { id: 'nav-/report', group: 'Navigate', label: 'Report a problem', hint: 'What went wrong, with the details that help find it', icon: <Bug className="w-3.5 h-3.5" />, run: () => navigate(`/report?from=${encodeURIComponent(location.pathname)}`) },
      { id: 'open-notifications', group: 'Navigate', label: 'Notifications', hint: 'Alerts that fired, Compass calls, paper fills — read or not', icon: <Inbox className="w-3.5 h-3.5" />, run: openNotices },
      { id: 'open-help', group: 'Navigate', label: 'Help & keyboard shortcuts', hint: 'Press ? anywhere', icon: <CircleHelp className="w-3.5 h-3.5" />, run: openHelp },
    ];
    return [...nav, ...gexSubs, ...compassSubs, ...recordSubs, ...flowSubs, ...help];
  }, [navigate, location.pathname]);

  // Ticker actions live outside the label filter: with a query they ARE the
  // search (symbol/name matched by searchTickers), resting they list the
  // names the sim already runs.
  const tickerActions = useMemo<PaletteAction[]>(() => {
    const q = query.trim();
    if (q && tickMod) {
      const rows = room === 'listed'
        ? tickMod.searchTickers(q, 8).map(t => ({ symbol: t.symbol, name: companyName(t.symbol) }))
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
    return QUICK_NAMES.map(tk => ({
      id: `ticker-${tk}`,
      group: 'Ticker' as const,
      label: (() => {
        const n = companyName(tk);
        return n && n.toUpperCase() !== tk ? `Set ticker → ${tk} · ${n}` : `Set ticker → ${tk}`;
      })(),
      hint: tk === activeTicker ? 'active' : '',
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
    /* a symbol typed in full ("nvda") is a ticker ask first */
    if (tickerActions[0]?.id === `ticker-${q.toUpperCase()}`) {
      return [...tickerActions, ...actions.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)), ...chartActions, ...drawActions];
    }
    return [
      ...actions.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)),
      ...chartActions,
      ...drawActions,
      ...tickerActions,
    ];
  }, [actions, tickerActions, drawActions, chartActions, query]);

  /* a fresh search each time it opens; the dialog moves focus to the search box itself */
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const runAction = (action: PaletteAction | undefined) => {
    if (!action) return;
    action.run();
    onClose();
  };

  /* the rows in their order, cut where the group changes — one heading per run, as before */
  const runs: { group: PaletteAction['group']; rows: PaletteAction[] }[] = [];
  for (const a of filtered) {
    const last = runs[runs.length - 1];
    if (last && last.group === a.group) last.rows.push(a);
    else runs.push({ group: a.group, rows: [a] });
  }

  /* THE PALETTE (shadcn Command in the house Dialog, 2026-11-01): the search box is a combobox naming the row the arrows
     are on, the rows are options; focus is held inside, Escape closes, focus goes back to whatever opened it. The rows
     are ranked here (the ticker directory, the actions), so cmdk is told not to filter. */
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent place="top" showClose={false} aria-label="Command palette" aria-describedby={undefined} className="max-w-lg shadow-black" data-command-palette>
        <Command shouldFilter={false} label="Type a command or destination">
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            icon={false}
            rowClassName="px-0"
            className="pl-4 pr-10 py-3"
            placeholder="Type a command or destination…"
            trailing={
              /* the names arrive as their own chunk on the first open; typed before they land, the search says it is on its way (ui/Working.tsx) */
              <Working active={open && !tickMod && query.trim().length > 0} className="absolute right-3.5 top-1/2 -translate-y-1/2" />
            }
          />
          <CommandList className="py-1.5">
            {filtered.length === 0 && <div className="px-4 py-6 text-center font-mono text-[11px] text-textMuted">No matches</div>}
            {runs.map((run, ri) => (
              <CommandGroup key={`${run.group}-${ri}`} heading={run.group}>
                {run.rows.map(action => (
                  <CommandItem key={action.id} value={action.id} onSelect={() => runAction(action)}>
                    <span className="text-textMuted group-data-[selected=true]:text-select">{action.icon}</span>
                    <span className="text-[13px] text-textPrimary">{action.label}</span>
                    <span className="ml-auto text-t10 font-mono text-textMuted truncate max-w-[45%]">{action.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-borderSubtle font-mono text-t10 text-textMuted select-none" aria-hidden>
          <span>↑↓ navigate</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" /> select
          </span>
          <span className="ml-auto">esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
