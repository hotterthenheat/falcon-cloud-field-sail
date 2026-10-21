/*
==================================================
  SLAYER TERMINAL - PULSE'S SKELETONS
  (pages/workspace/pulseSkeletons.tsx)

  The desk standing in as itself (rebuilt 2026-09-30
  with the desk): the one bar — the title, the desks,
  the three buttons — then The session's four tiles,
  each with its one-line head. A tile's own stand-in
  for the frame it takes to mount is one of three
  shapes: a tape, a list of rows over a read line, or
  a drawn figure over a read line. And the board: the
  back button and its title, then four name cards two
  across. Imports nothing heavy.
==================================================
*/

import type { ReactNode } from 'react';
import { Block, ChartGround, Line, ScopeChipMark } from '../../components/ui/skeletonKit';

/** The tile's read line at its foot */
const ReadFoot = () => (
  <div className="shrink-0 px-3 py-2 border-t border-ink/[0.06]">
    <Line w="82%" h={9} />
  </div>
);

/** A tape */
export const ChartTileSkeleton = () => (
  <div className="relative h-full">
    <ChartGround />
  </div>
);

/** A list: the column heads, the rows, the read */
export const RowsTileSkeleton = ({ rows = 8, heads = true }: { rows?: number; heads?: boolean }) => (
  <div className="h-full flex flex-col" aria-hidden>
    {heads && (
      <div className="shrink-0 h-6 px-3 flex items-center gap-4 border-b border-ink/[0.06]">
        <Line w={44} h={7} />
        <Line w={60} h={7} />
        <Line w={40} h={7} className="ml-auto" />
      </div>
    )}
    <div className="flex-1 min-h-0 overflow-hidden">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-[32px] px-3 flex items-center gap-3 border-b border-borderSubtle/40">
          <Line w={48} h={10} />
          <Line w={`${38 + ((i * 17) % 34)}%`} h={9} />
          <Line w={44} h={10} className="ml-auto" />
        </div>
      ))}
    </div>
    <ReadFoot />
  </div>
);

/** A drawn figure over its read */
export const FigureTileSkeleton = () => (
  <div className="h-full flex flex-col" aria-hidden>
    <div className="flex-1 min-h-0 p-3">
      <Block w="100%" h="100%" className="rounded-md" />
    </div>
    <ReadFoot />
  </div>
);

/** The tile's head: the grip, the icon, the title, its cards, the chip, the door, the menu */
const TileHead = ({ title, cards = 0, chip = true }: { title: number; cards?: number; chip?: boolean }) => (
  <div className="flex items-center gap-2 pl-2.5 pr-1.5 h-[38px] border-b border-borderSubtle shrink-0">
    <Block w={14} h={14} className="rounded-sm" />
    <Block w={14} h={14} className="rounded-sm" />
    <Line w={title} h={12} />
    {Array.from({ length: cards }, (_, i) => (
      <Block key={i} w={86} h={24} className="rounded-md" />
    ))}
    <span className="ml-auto flex items-center gap-1.5">
      {chip && <ScopeChipMark />}
      <Block w={24} h={24} className="rounded" />
      <Block w={24} h={24} className="rounded" />
    </span>
  </div>
);

const Tile = ({ className, title, cards, chip, children }: { className: string; title: number; cards?: number; chip?: boolean; children: ReactNode }) => (
  <div className={`border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col ${className}`}>
    <TileHead title={title} cards={cards} chip={chip} />
    <div className="flex-grow min-h-0 overflow-hidden relative">{children}</div>
  </div>
);

export const PulsePageSkeleton = () => (
  <>
    {/* the desk bar */}
    <div className="flex items-center gap-3 h-9" aria-hidden data-skeleton="pulse">
      <Line w={58} h={18} />
      <span className="w-px h-4 bg-borderSubtle" />
      <div className="flex items-center gap-1.5">
        {[92, 76, 52, 78, 70].map((w, i) => (
          <Block key={i} w={w} h={26} className="rounded-md" />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Block w={112} h={28} className="rounded-md" />
        <Block w={84} h={28} className="rounded-md" />
        <Block w={28} h={28} className="rounded-md" />
      </div>
    </div>
    {/* The session: the chart and the book, then the range and the alerts — twelve columns, rows of 88 with a 12px gutter */}
    <div className="grid grid-cols-12 gap-3" aria-hidden aria-busy="true" aria-label="Loading">
      <Tile className="col-span-7 h-[488px]" title={38} cards={2}>
        <ChartGround />
      </Tile>
      <Tile className="col-span-5 h-[488px]" title={62} cards={2}>
        <RowsTileSkeleton rows={12} />
      </Tile>
      <Tile className="col-span-8 h-[388px]" title={66}>
        <FigureTileSkeleton />
      </Tile>
      <Tile className="col-span-4 h-[388px]" title={44} cards={1} chip={false}>
        <RowsTileSkeleton rows={8} heads={false} />
      </Tile>
    </div>
  </>
);

/** The board: the back button and the title, then the name cards two across */
export const PulseBoardSkeleton = () => (
  <>
    <div className="flex items-center gap-3 h-[35px]" aria-hidden data-skeleton="pulse-board">
      <Block w={32} h={32} className="rounded-md" />
      <div className="flex flex-col justify-between h-[35px] py-[2px]">
        <Line w={160} h={16} />
        <Line w={286} h={10} />
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" aria-hidden aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="relative flex flex-col min-h-0 overflow-hidden border border-borderSubtle rounded-md bg-panel">
          <div className="shrink-0 w-full flex items-center gap-2.5 flex-wrap px-2.5 py-1.5 h-[69px]">
            <Block w={78} h={28} className="rounded-md" />
            <Line w={47} h={11} />
            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
              {[70, 80, 90, 70, 80].map((w, k) => (
                <Line key={k} w={w} />
              ))}
            </div>
          </div>
          <div className="h-[38vh] min-h-[300px] relative">
            <ChartGround />
          </div>
        </div>
      ))}
    </div>
  </>
);
