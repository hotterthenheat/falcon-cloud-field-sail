/*
  The frame every Pulse tile wears: one head line that is the drag handle (grip, icon, title, the tile's controls,
  its name and link, its door and menu), and the body sized to what is left.
*/

import { useCallback, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, Copy, GripHorizontal, Maximize2, MoreHorizontal, Scaling, SlidersHorizontal, Trash2 } from 'lucide-react';
import DropdownSelect, { CARD } from '../../components/ui/DropdownSelect';
import ScopeChip from '../../components/ui/ScopeChip';
import { Deferred } from '../../components/ui/Skeleton';
import type { TileControl, TileSize, TileState, WidgetDef, WorkspaceCtx } from './tile';

export const TILE_HEAD_H = 38;

export const sizeOf = (w: number, h: number): TileSize => ({
  w: Math.round(w / 20) * 20,
  h: Math.round(h / 20) * 20,
  room: w < 440 ? 'small' : w < 780 ? 'medium' : 'large',
  short: h < 280,
});

/** The body's own box, coarse — a callback ref, so it is measured in the commit that mounts it */
const useTileSize = () => {
  const [size, setSize] = useState<TileSize | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const next = sizeOf(r.width, r.height);
      setSize(prev => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    read();
    ro.current = new ResizeObserver(read);
    ro.current.observe(el);
  }, []);
  return [ref, size] as const;
};

/* HOW THE CONTROLS STAND, off the tile's own width (the library's arithmetic — known before paint, so the head never
   lays out twice): what is left of the line after the title, the chip, the door and the menu is the controls' room; a
   card's width is estimated off its words in the mono face. */
type Standing = 'named' | 'bare' | 'door';
interface HeadPlan {
  standing: Standing;
  /** How many of the cards stand on the line — the rest are behind the sliders door */
  inline: number;
  /** No room for the grip and the widget's icon: the title keeps its words */
  tight: boolean;
}
const cardW = (c: TileControl, value: string, bare: boolean) => (bare ? 0 : c.label.length * 6.4 + 8) + value.length * 6.9 + 38;
const planOf = (width: number, def: WidgetDef, controls: TileControl[], state: TileState, hasScope: boolean, hasDoor: boolean, locked: boolean): HeadPlan => {
  const rest = def.title.length * 7 + 14 + (def.toggles?.length ?? 0) * 30 + (hasScope ? 108 : 0) + (hasDoor || def.fullscreen ? 30 : 0) + 30 + 28;
  const glyphs = (locked ? 0 : 22) + 22;
  const tight = width - rest - glyphs < (controls.length ? 30 : 0);
  const room = width - rest - (tight ? 0 : glyphs);
  if (!controls.length) return { standing: 'named', inline: 0, tight };
  /* the card's own fallback: a setting not yet made shows the first choice */
  const valueOf = (c: TileControl) => c.options.find(o => o.value === String(state[c.id] ?? c.options[0]?.value ?? ''))?.label ?? '';
  const sum = (bare: boolean) => controls.reduce((a, c) => a + cardW(c, valueOf(c), bare) + 6, 0);
  if (sum(false) <= room) return { standing: 'named', inline: controls.length, tight };
  if (sum(true) <= room) return { standing: 'bare', inline: controls.length, tight };
  /* not all of them: the first ones that fit beside the sliders door, bare */
  let used = 30;
  let inline = 0;
  for (const c of controls) {
    used += cardW(c, valueOf(c), true) + 6;
    if (used > room) break;
    inline++;
  }
  return { standing: 'door', inline, tight };
};

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const headBtn = 'inline-flex items-center justify-center w-7 h-7 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] data-[state=open]:text-textPrimary data-[state=open]:bg-ink/[0.06] transition-colors';
const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 outline-none cursor-pointer font-mono text-t11 text-textSecondary data-[highlighted]:bg-ink/[0.06] data-[highlighted]:text-textPrimary transition-colors';

interface Props {
  def: WidgetDef;
  /** The context for the name this tile is on — null while the feed has none for it */
  ctx: WorkspaceCtx | null;
  /** The instance's settings over the widget's defaults */
  state: TileState;
  onState: (patch: TileState) => void;
  /** The tile's laid-out width in pixels */
  width: number;
  /** Its place in the desk's mount order — one tile a frame */
  index: number;
  locked: boolean;
  /** The name it follows or holds — given only to a tile about a name */
  scope?: { ticker: string; linked: boolean; onPick: (ticker: string) => void; onToggleLink: () => void };
  onOpen?: () => void;
  onDuplicate: () => void;
  onResetSize: () => void;
  onRemove: () => void;
}

const Tile = ({ def, ctx, state, onState, width, index, locked, scope, onOpen, onDuplicate, onResetSize, onRemove }: Props) => {
  const [bodyRef, size] = useTileSize();
  /* the head's fullscreen button, counted — the body lifts its own fullscreen each time it changes */
  const [lift, setLift] = useState(0);
  const controls = ctx && def.controls ? def.controls({ ctx, state }) : [];
  const { standing, inline, tight } = planOf(width, def, controls, state, !!scope, !!onOpen, locked);
  const Icon = def.icon;
  const card = (c: TileControl, bare: boolean, big = false) => (
    <DropdownSelect key={c.id} label={c.label} title={c.title} value={String(state[c.id] ?? c.options[0]?.value ?? '')} options={c.options} onChange={v => onState({ [c.id]: v })} size={big ? 'md' : 'sm'} bare={bare} testId={`tile-${def.key}-${c.id}`} />
  );

  return (
    <>
      <div className={`${locked ? '' : 'widget-drag cursor-grab active:cursor-grabbing'} flex items-center gap-2 pl-2.5 pr-3 border-b border-borderSubtle shrink-0 select-none`} style={{ height: TILE_HEAD_H }} data-tile-head data-tile-controls={controls.length ? standing : undefined}>
        {!locked && !tight && <GripHorizontal className="w-3.5 h-3.5 text-textMuted shrink-0" aria-hidden />}
        {!tight && <Icon className="w-3.5 h-3.5 text-textSecondary shrink-0" aria-hidden />}
        <span className="shrink min-w-0 truncate text-t12 font-semibold text-textPrimary" title={def.says} data-tile-title>
          {def.title}
        </span>
        {inline > 0 && (
          <span className="shrink-0 flex items-center gap-1.5" onMouseDown={stop}>
            {controls.slice(0, inline).map(c => card(c, standing !== 'named'))}
          </span>
        )}
        {/* over the grid's corner handle: the top-right corner resizes the tile, and the last button must not be under it */}
        <span className="relative z-[2] ml-auto shrink-0 flex items-center gap-0.5" onMouseDown={stop}>
          {standing === 'door' && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button type="button" className={headBtn} title={inline > 0 ? 'The rest of its settings' : 'Its settings'} aria-label={`${def.title}: settings`} data-tile-settings>
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={6} className={`${CARD} p-2 flex flex-col gap-1.5`} data-tile-settings-card>
                  {controls.slice(inline).map(c => card(c, false, true))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
          {def.toggles?.map(t => {
            const on = !!state[t.id];
            return (
              <button key={t.id} type="button" onClick={() => onState({ [t.id]: !on })} aria-pressed={on} className={`${headBtn} ${on ? '!text-silver bg-silver/[0.08]' : ''}`} title={on ? `Close ${t.label.toLowerCase()}` : t.title} aria-label={t.label} data-tile-toggle={t.id}>
                <t.icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
          {scope && <ScopeChip ticker={scope.ticker} linked={scope.linked} onPick={scope.onPick} onToggleLink={scope.onToggleLink} />}
          {def.fullscreen ? (
            <button type="button" onClick={() => setLift(n => n + 1)} className={headBtn} title="Fullscreen — the whole toolbar, the indicators and the drawing tools" aria-label={`${def.title}: fullscreen`} data-tile-fullscreen>
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          ) : (
            onOpen &&
            def.page && (
              <button type="button" onClick={onOpen} className={headBtn} title={def.page.run ? `Open ${def.page.label}` : `Open ${def.page.label} — the whole page, with a way back here`} aria-label={`Open ${def.page.label}`} data-tile-door={typeof def.page.path === 'string' ? def.page.path : def.page.path(state)}>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )
          )}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={headBtn} title="More" aria-label={`${def.title}: more`} data-tile-more>
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className={`${CARD} min-w-[190px] p-1.5`} data-tile-menu>
                {def.fullscreen && onOpen && def.page && (
                  <>
                    <DropdownMenu.Item className={menuItem} onSelect={onOpen} data-tile-door={typeof def.page.path === 'string' ? def.page.path : ''}>
                      <ArrowUpRight className="w-3 h-3" /> Open in {def.page.label}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-borderSubtle" />
                  </>
                )}
                <DropdownMenu.Item className={menuItem} onSelect={onDuplicate} data-tile-duplicate>
                  <Copy className="w-3 h-3" /> Another one of these
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menuItem} onSelect={onResetSize} data-tile-resize>
                  <Scaling className="w-3 h-3" /> Its own size again
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-borderSubtle" />
                <DropdownMenu.Item className={`${menuItem} data-[highlighted]:!text-bear`} onSelect={onRemove} data-tile-remove>
                  <Trash2 className="w-3 h-3" /> Take it off the desk
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </div>
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-hidden" data-tile-body data-room={size?.room}>
        {!ctx ? (
          <span className="flex h-full items-center justify-center font-mono text-t10 text-textMuted uppercase tracking-widest">No data for {scope?.ticker ?? 'this name'} yet</span>
        ) : (
          size && (
            <Deferred index={index} fallback={def.skeleton()} className="h-full animate-fade-in">
              <def.Body ctx={ctx} state={state} set={onState} size={size} open={onOpen ?? (() => undefined)} lift={lift} pickTicker={scope?.onPick} />
            </Deferred>
          )
        )}
      </div>
    </>
  );
};

export default Tile;
