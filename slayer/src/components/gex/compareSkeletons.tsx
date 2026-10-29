/* Compare's skeletons in their own shape (the ruler box with its side reads, today's two lines, the pair). Imports only the kit;
   the surfaces import their geometry from here. */

import { Skeleton } from '../ui/Skeleton';
import { Block, Box, ChartGround, Facts, Line, SubLine, TitleRow } from '../ui/skeletonKit';

/* ---- geometry shared with HeadToHead.tsx / CompareAxis.tsx / CompareRuler.tsx / CompareTapes.tsx / ComparePair.tsx ---- */

/** A name's read beside the ruler: the panel open, its tab folded. */
const SIDE_W = 320;
/** The drawing's height, the lane heads over it and the read line under it. */
export const AXIS_H = 640;
export const AXIS_HEADS_H = 22;
export const AXIS_READ_H = 26;
/** The ruler's own column — the distances */
export const AXIS_COL_W = 60;
/** The spine of strikes: a column of strike figures each side of the ruler. */
export const AXIS_STRIKE_W = 46;
/** Today's two lines, and the read line under them */
export const TAPES_H = 300;
export const TAPES_READ_H = 26;
/** The pair over the sessions — the drawing's height and its margins — and its read line */
/* The pair stands as a chart, not a strip. */
export const PAIR_H = 300;
const PAIR_M = { l: 16, r: 84, t: 22, b: 28 };
export const PAIR_READ_H = 26;

/* ---- box 1 ---------------------------------------------------------------------- */

/** A name's read beside the ruler, standing */
export const CompareSideInner = ({ side }: { side: 'a' | 'b' }) => (
  <div className={`shrink-0 flex flex-col gap-2 px-3 pt-3 pb-3 ${side === 'a' ? 'border-r' : 'border-l'} border-borderSubtle/60`} style={{ width: SIDE_W }} aria-hidden data-skeleton={`compare-side-${side}`}>
    <Skeleton className="h-6 w-[176px] rounded-md" />
    {[190, 120, 260, 200, 200, 200, 200, 180, 150, 150, 150, 150, 150, 150, 170, 120, 220, 170, 200, 200, 200, 200].map((w, i) => (
      <Line key={i} w={Math.min(w, SIDE_W - 24)} h={i === 1 ? 16 : 10} />
    ))}
  </div>
);

/* ---- box 2 ---------------------------------------------------------------------- */

/** The two books on one ruler, standing */
export const CompareAxisInner = () => {
  const rows = 15;
  const mid = 7;
  const spine = AXIS_COL_W + 2 * AXIS_STRIKE_W;
  return (
    <section className="flex flex-col min-w-0" aria-hidden data-skeleton="compare-axis">
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <TitleRow title={196} chip={false} />
          <SubLine w={640} />
        </div>
        <Facts widths={[60, 104, 104]} />
      </div>
      <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
        {/* Expiry · Reach · Greek · Colours, at their measured widths. */}
        <Skeleton className="h-7 w-[163px] rounded-md" />
        <Skeleton className="h-7 w-[203px] rounded-md" />
        <Skeleton className="h-7 w-[103px] rounded-md" />
        <Skeleton className="h-7 w-[140px] rounded-md" />
        <Line w={220} h={9} className="ml-auto" />
      </div>
      <div className="px-5 flex items-center justify-between" style={{ height: AXIS_HEADS_H }}>
        <Line w={300} h={10} />
        <Line w={300} h={10} />
      </div>
      <div className="relative" style={{ height: AXIS_H }}>
        <div className="absolute inset-y-3 left-1/2 -translate-x-1/2 rounded bg-ink/[0.025]" style={{ width: AXIS_COL_W }} />
        {Array.from({ length: rows }, (_, r) => {
          const t = 1 - Math.abs(r - mid) / mid;
          const y = 14 + r * ((AXIS_H - 28) / (rows - 1));
          const wl = 8 + Math.round(t * t * 80);
          const wr = 8 + Math.round((1 - Math.abs(r - mid + 2) / mid) ** 2 * 70);
          return (
            <div key={r} className="absolute inset-x-0" style={{ top: y - 7, height: 14 }}>
              <Block w={`${wl * 0.4}%`} h={14} className="absolute rounded-full" style={{ right: `calc(50% + ${spine / 2 + 4}px)`, opacity: 0.35 + t * 0.5 }} />
              {/* the spine: a strike each side, the distance in the middle */}
              <Line w={26} h={9} className="absolute top-[2px]" style={{ right: `calc(50% + ${AXIS_COL_W / 2 + 6}px)` }} />
              <Line w={30} h={9} className="absolute left-1/2 -translate-x-1/2 top-[2px]" />
              <Line w={26} h={9} className="absolute top-[2px]" style={{ left: `calc(50% + ${AXIS_COL_W / 2 + 6}px)` }} />
              <Block w={`${Math.max(4, wr) * 0.4}%`} h={14} className="absolute rounded-full" style={{ left: `calc(50% + ${spine / 2 + 4}px)`, opacity: 0.35 + t * 0.5 }} />
            </div>
          );
        })}
      </div>
      <div className="px-5 border-t border-ink/[0.06] flex items-center gap-3" style={{ height: AXIS_READ_H }}>
        <Line w={160} h={10} />
        <Line w={220} h={10} />
      </div>

      <div className="h-3" />
    </section>
  );
};

/* ---- box 3 ---------------------------------------------------------------------- */

/** Since the open, standing */
export const CompareTapesInner = () => (
  <section className="flex flex-col min-w-0" aria-hidden data-skeleton="compare-tapes">
    <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
      <div className="min-w-0 flex-1">
        <TitleRow title={110} chip={false} door={false} />
        <SubLine w={620} />
      </div>
      <Facts widths={[150, 96, 130]} />
    </div>
    <div className="border-t border-borderSubtle/60" style={{ height: TAPES_H }}>
      <ChartGround axis={60} />
    </div>
    <div className="px-5 border-t border-ink/[0.06] flex items-center gap-3" style={{ height: TAPES_READ_H }}>
      <Line w={36} h={10} />
      <Line w={90} h={10} />
      <Line w={90} h={10} />
      <Line w={120} h={10} />
    </div>
  </section>
);

/* ---- box 4 ---------------------------------------------------------------------- */

/** The pair, standing: the band, the average through it, one line of sessions. */
export const ComparePairInner = () => {
  const dots = 21;
  const inner = PAIR_H - PAIR_M.t - PAIR_M.b;
  return (
    <section className="flex flex-col min-w-0" aria-hidden data-skeleton="compare-pair">
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <TitleRow title={132} chip={false} />
          <SubLine w={620} />
        </div>
      </div>
      <div className="relative border-t border-borderSubtle/60" style={{ height: PAIR_H }}>
        <Block w={`calc(100% - ${PAIR_M.l + PAIR_M.r}px)`} h={inner * 0.34} className="absolute rounded-sm opacity-40" style={{ left: PAIR_M.l, top: PAIR_M.t + inner * 0.33 }} />
        <Line w={`calc(100% - ${PAIR_M.l + PAIR_M.r}px)`} h={1} className="absolute" style={{ left: PAIR_M.l, top: PAIR_M.t + inner * 0.5 }} />
        {Array.from({ length: dots }, (_, i) => {
          const t = i / (dots - 1);
          const y = PAIR_M.t + inner * (0.5 + 0.3 * Math.sin(i * 1.3));
          return <Block key={i} w={6} h={6} className="absolute rounded-full" style={{ left: `calc(${PAIR_M.l}px + (100% - ${PAIR_M.l + PAIR_M.r}px) * ${t})`, top: y - 3, opacity: 0.5 + t * 0.4 }} />;
        })}
        <div className="absolute" style={{ right: 8, top: PAIR_M.t + inner * 0.5 - 6 }}>
          <Line w={56} h={12} />
        </div>
        <div className="absolute flex justify-between" style={{ left: PAIR_M.l, right: PAIR_M.r, bottom: 6 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Line key={i} w={34} h={8} />
          ))}
        </div>
      </div>
      <div className="px-5 border-t border-ink/[0.06] flex items-center gap-3" style={{ height: PAIR_READ_H }}>
        <Line w={36} h={10} />
        <Line w={80} h={10} />
        <Line w={100} h={10} />
        <Line w={160} h={10} />
      </div>
      {/* The pair's sentence is always two lines (63 = 8 + 2 × 19.5 + 16). */}
      <div className="px-5 pb-4 pt-2 min-h-[63px] flex flex-col justify-center gap-[9px]">
        <Line w="96%" h={11} />
        <Line w="38%" h={11} />
      </div>
    </section>
  );
};

/* ---- the page ------------------------------------------------------------------- */

export const ComparePageSkeleton = () => (
  <>
    <Box data-skeleton="compare-1">
      <div className="flex items-stretch min-w-0">
        <CompareSideInner side="a" />
        <div className="flex-1 min-w-0">
          <CompareAxisInner />
        </div>
        <CompareSideInner side="b" />
      </div>
    </Box>
    <Box data-skeleton="compare-2">
      <CompareTapesInner />
    </Box>
    <Box data-skeleton="compare-3">
      <ComparePairInner />
    </Box>
  </>
);
