/*
==================================================
  SLAYER TERMINAL - THE AGENDA
  (pages/pinpoint/Agenda.tsx)

  Targets and Building on ONE page, switched at the
  head (Noah, 2026-10-14: "i want the building page
  and the target page to have the same function as
  the simulated returns and our read. so they should
  be on the same page put interchangable" — the
  Weigher card's two faces; the name is mine at his
  word, "choose a name for the overhead section
  name"): THE AGENDA — what to watch today, in what
  order, and what today built. Two faces:

    TARGETS    every strike in the order it matters
               (pages/pinpoint/RankedTargets.tsx)
    BUILDING   what today added to every strike, and
               where the walls are heading
               (pages/pinpoint/Building.tsx)

  THE FACE IS THE ADDRESS: /pinpoint/agenda opens on
  Targets, ?view=building on Building — so a link
  carries its face, Back walks between them, and the
  old addresses (/pinpoint/targets, /pinpoint/building)
  land on the face they named. THE SWITCH STANDS
  WHERE THE BOX'S NAME STANDS (Noah, with the box
  head circled: "i want the targetes and building
  buttons to be there"): the first box of either
  face wears AgendaSwitch as its title — Targets ·
  Building at the title's own size — and the shell's
  head keeps the page's name with the face's line
  under it.

  BOTH FACES STAND, ONE IN HAND (Noah, 2026-10-14:
  "the targets to building change should be a smooth
  transition right now it seems like its opening up
  two totally different pages so its slow"): a face
  seen once stays mounted — its scan, its read and
  its choices warm — folded to no height and unseen
  while the other is in hand, the two in one grid
  cell so the box heads share a spot. The other face
  is mounted on its own, a beat after the first has
  landed, so the first press never waits on a build.
  The switch is then a fade between two standing
  trees — never a skeleton, never a reload. Before
  this the faces swapped under a wait-mode presence:
  the old one faded out, the new one mounted cold
  (its page skeleton, a deferred frame, the board's
  own fade) — two pages, by the look of it.
*/

import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import CardTabs from '../../components/ui/CardTabs';
import { motion } from 'framer-motion';
import RankedTargets from './RankedTargets';
import Building from './Building';
import { todayScopeLabel } from '../../data/bookWindow';

export type AgendaFace = 'targets' | 'building';
export const AGENDA_FACES = [
  { value: 'targets', label: 'Targets' },
  { value: 'building', label: 'Building' },
] as const;
/** The face an address names — Targets unless it asks for Building */
export const agendaFaceOf = (search: string): AgendaFace => (new URLSearchParams(search).get('view') === 'building' ? 'building' : 'targets');
/** What the shell's line says under the name, a face at a time */
/* "today" only while today's session is ahead or running — after the close it is the next session's (the fourth audit's m7) */
export const AGENDA_LINES: Record<AgendaFace, string> = {
  get targets() {
    return `Every strike, in the order it matters ${todayScopeLabel() === 'Today' ? 'today' : 'next session'}`;
  },
  building: 'What the last overnight open-interest count added to every strike — walls forming before they are the wall, draining before they break',
};
/** The other face is mounted, unseen, this long after the page lands — past the shell's crossfade (200ms) and the
    first box's own fade (420ms), so its build never sits on the first paint */
const WARM_AFTER_MS = 800;

/** The switch, as a box's title: the face in hand in the title's ink, the other a step back, the rule under the one in
    hand; it writes the face to the address (a push, so Back walks between the faces) */
export const AgendaSwitch = () => {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const face = agendaFaceOf(location.search);
  return (
    <span data-agenda-switch={face}>
      <CardTabs size="title" options={AGENDA_FACES} value={face} onChange={f => setSearchParams(f === 'building' ? { view: 'building' } : {})} ariaLabel="Targets, or Building" />
    </span>
  );
};

const FACE_EASE = [0.16, 1, 0.3, 1] as const;

const Agenda = () => {
  const [params] = useSearchParams();
  const face = agendaFaceOf(params.toString() ? `?${params.toString()}` : '');
  /* the faces seen so far stay mounted; the rest join once the page has landed */
  const seen = useRef(new Set<AgendaFace>());
  seen.current.add(face);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const id = globalThis.setTimeout(() => setWarm(true), WARM_AFTER_MS);
    return () => globalThis.clearTimeout(id);
  }, []);
  return (
    <div className="grid flex-grow min-w-0" data-agenda={face}>
      {AGENDA_FACES.map(({ value: f }) => {
        if (!warm && !seen.current.has(f)) return null;
        const inHand = f === face;
        return (
          <motion.div
            key={f}
            /* one cell for both: the face in hand fills it, the other keeps no height, unseen and out of the pointer's way */
            className={`[grid-area:1/1] flex flex-col gap-4 min-w-0 ${inHand ? '' : 'invisible h-0 overflow-hidden pointer-events-none'}`}
            aria-hidden={!inHand}
            initial={false}
            animate={{ opacity: inHand ? 1 : 0, y: inHand ? 0 : 4 }}
            transition={{ duration: inHand ? 0.18 : 0, ease: FACE_EASE }}
            data-agenda-face={f}
            data-in-hand={inHand ? 'true' : 'false'}
          >
            {f === 'building' ? <Building /> : <RankedTargets />}
          </motion.div>
        );
      })}
    </div>
  );
};

export default Agenda;
