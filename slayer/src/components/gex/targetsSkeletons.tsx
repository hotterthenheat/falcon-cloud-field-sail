/*
==================================================
  SLAYER TERMINAL - THE TARGETS PAGE'S SKELETONS
  (components/gex/targetsSkeletons.tsx)

  The two boxes standing in their own shape: the
  agenda (head with its four facts, the line of
  controls, the sentence, three cards, the list on
  the SAME column template) and the strike axis at
  the drawing's exact aspect. Imports nothing but
  Skeleton; the surfaces import their geometry from
  here, so the two cannot drift.
==================================================
*/

import { Skeleton } from '../ui/Skeleton';

/* ---- geometry shared with TargetsBoard.tsx ---------------------------------------- */

/** # · strike · from spot · reached · holds · if it breaks · today · at stake · why · actions */
/* The words columns WRAP to two lines and share the room (the UI sweep, 2026-10-22): at 1200px the list ran past a
   laptop's card and "changed sides −$4M last session" sat cut in a 112px column — the narrow columns gave up what they
   did not use, and the floor now fits a 1440 screen beside the rail */
export const AGENDA_COLUMNS = '32px 148px 64px 64px 96px minmax(140px,1fr) minmax(140px,1fr) 100px minmax(90px,1fr) 124px';
/** The columns' floor plus nine 12px gaps */
export const AGENDA_MIN_W = 1106;
export const CARD_H = 158;
export const ROW_H = 32;

/* ---- box 1 ---------------------------------------------------------------------- */

const CardSkeleton = ({ pick = false }: { pick?: boolean }) => (
  <div className={`relative rounded-md border p-3 flex flex-col ${pick ? 'border-supreme/30' : 'border-borderSubtle'}`} style={{ height: CARD_H }}>
    <div className="flex items-center gap-2 h-[22px]">
      <Skeleton className="h-4 w-[92px] rounded-full" />
      <Skeleton className="h-4 w-10" line />
      <Skeleton className="h-2.5 w-12" line />
      <Skeleton className="ml-auto h-2.5 w-12" line />
    </div>
    <div className="mt-2 flex items-center justify-between h-[14px]">
      <Skeleton className="h-2 w-[76px]" line />
      <Skeleton className="h-2 w-[54px]" line />
    </div>
    <Skeleton className="mt-1 h-[8px] w-full rounded-full" />
    <div className="mt-2 h-[15px] flex items-center">
      <Skeleton className="h-2.5 w-[86%]" line />
    </div>
    <div className="mt-1 h-[15px] flex items-center gap-3">
      <Skeleton className="h-2.5 w-[120px]" line />
      <Skeleton className="h-2.5 w-[90px]" line />
    </div>
    <div className="mt-auto flex items-center justify-end gap-1 h-[22px]">
      <Skeleton className="h-4 w-14" line />
      <Skeleton className="h-4 w-12" line />
    </div>
  </div>
);

/** The agenda, standing — `bare`: one pane's form (its line of chip, Expiry card and watch; no box head, no controls) */
export const TargetsInner = ({ rows = 38, bare = false }: { rows?: number; bare?: boolean }) => (
  <section className="flex flex-col min-w-0" aria-hidden data-skeleton="targets">
    {/* THE HEAD — the box's, or a pane's line */}
    <div className={bare ? 'px-5 pt-3 pb-2 flex items-start gap-x-6 gap-y-2 flex-wrap' : 'px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap'}>
      {bare ? (
        <div className="h-7 flex items-center gap-2">
          <Skeleton className="h-6 w-[104px] rounded-full" />
          <Skeleton className="h-7 w-[132px]" />
          <Skeleton className="h-7 w-[73px]" />
        </div>
      ) : (
      <div className="min-w-0 flex-1">
        <div className="h-6 flex items-center gap-3">
          <Skeleton className="h-3.5 w-[64px]" line />
          <Skeleton className="h-5 w-[104px] rounded-full" />
          <Skeleton className="h-3 w-[72px]" line />
        </div>
        <div className="mt-0.5 h-[17px] flex items-center">
          <Skeleton className="h-2.5 w-[520px] max-w-full" line />
        </div>
      </div>
      )}
      <dl className={`flex flex-wrap gap-x-6 gap-y-2 ${bare ? 'ml-auto' : ''}`}>
        {[[58, 60], [92, 72], [110, 60], [70, 68]].map(([dt, dd], i) => (
          <div key={i}>
            <div className="h-[15px] flex items-center">
              <Skeleton className="h-2.5" style={{ width: dt }} line />
            </div>
            <div className="mt-0.5 h-[18px] flex items-center">
              <Skeleton className="h-3" style={{ width: dd }} line />
            </div>
          </div>
        ))}
      </dl>
    </div>

    {/* THE ONE LINE OF CONTROLS — the box's, not a pane's */}
    {!bare && (
      <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
        <Skeleton className="h-7 w-[168px]" />
        <Skeleton className="h-7 w-[132px]" />
        <Skeleton className="h-7 w-[73px]" />
        <Skeleton className="ml-auto h-2.5 w-44" line />
      </div>
    )}

    {/* THE SENTENCE — the surface's min-h-[34px] line */}
    <div className="mx-5 px-3 py-2 border-y border-borderSubtle/60 h-[34px] flex items-center gap-2">
      <Skeleton className="h-3 w-10" line />
      <Skeleton className="h-2.5 w-[70%]" line />
    </div>

    {/* THE THREE */}
    <div className="px-5 pt-3 pb-3 grid grid-cols-3 gap-3">
      <CardSkeleton pick />
      <CardSkeleton />
      <CardSkeleton />
    </div>

    {/* THE LIST */}
    <div className="px-5 pb-2 overflow-x-auto">
      <div className="grid items-center gap-x-3 gap-y-0" style={{ gridTemplateColumns: AGENDA_COLUMNS, minWidth: AGENDA_MIN_W }}>
        {[10, 34, 54, 48, 34, 62, 36, 50, 24, 44].map((w, i) => (
          <div key={`h-${i}`} className={`h-[14px] flex items-center ${i >= 2 && i <= 4 ? 'justify-end' : i === 9 ? 'justify-end' : ''}`}>
            <Skeleton className="h-2" style={{ width: w }} line />
          </div>
        ))}
        {Array.from({ length: rows }, (_, r) => {
          const fade = 1 - Math.min(0.55, r * 0.02);
          return (
            <div key={r} className="grid grid-cols-subgrid col-span-10 items-center border-t border-borderSubtle/40" style={{ height: ROW_H }}>
              <div className="flex items-center">
                <Skeleton className="h-2.5 w-4" line style={{ opacity: fade }} />
              </div>
              <div className="flex items-center gap-1.5 px-2">
                <Skeleton className="h-3 w-9" line style={{ opacity: fade }} />
                {r % 5 === 0 && <Skeleton className="h-2 w-10" line style={{ opacity: fade }} />}
              </div>
              <div className="flex items-center justify-end">
                <Skeleton className="h-2.5 w-10" line style={{ opacity: fade }} />
              </div>
              <div className="flex items-center justify-end">
                <Skeleton className="h-2.5 w-7" line style={{ opacity: fade }} />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Skeleton className="h-2.5 w-7" line style={{ opacity: fade }} />
                <Skeleton className="h-[6px] w-[52px] rounded-full" style={{ opacity: fade }} />
              </div>
              <div className="flex items-center">
                <Skeleton className="h-2.5" line style={{ width: [150, 120, 160, 130][r % 4], opacity: fade }} />
              </div>
              <div className="flex items-center">
                <Skeleton className="h-2.5" line style={{ width: r % 3 === 0 ? 96 : 40, opacity: fade }} />
              </div>
              <div className="relative flex items-center">
                <span className="absolute inset-y-[12px] left-0 right-14 rounded-full bg-ink/[0.04]" />
                <Skeleton className="absolute inset-y-[12px] left-0 rounded-full" style={{ width: `${[70, 48, 60, 30, 22, 16, 12][r % 7]}%`, opacity: fade }} />
                <Skeleton className="absolute right-0 h-2.5 w-10" line style={{ opacity: fade }} />
              </div>
              <div className="flex items-center">
                <Skeleton className="h-2.5" line style={{ width: [170, 140, 180, 150][r % 4], opacity: fade }} />
              </div>
              <div className="flex items-center justify-end gap-1">
                <Skeleton className="h-4 w-14" line style={{ opacity: fade }} />
                <Skeleton className="h-4 w-12" line style={{ opacity: fade }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {/* THE FOOT — 12px on leading-relaxed is a 19.5px line */}
    <div className="px-5 pb-4 pt-2 h-[44px] flex items-center">
      <Skeleton className="h-3 w-[58%]" line />
    </div>
  </section>
);

/* (box 2, the strike axis, went with its box on 2026-10-14) */

/* ---- the page ------------------------------------------------------------------- */

export const TargetsPageSkeleton = ({ rows = 38 }: { rows?: number }) => (
  <div className="border border-borderSubtle rounded-md bg-panel" data-targets>
    <TargetsInner rows={rows} />
  </div>
);
