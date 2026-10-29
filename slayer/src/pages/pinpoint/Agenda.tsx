/* The Agenda: Targets and Building on one page. The face is the address (?view=building), and the switch is the first box's title.
   A face seen once stays mounted (folded, unseen) so switching is a fade between two standing trees, never a reload. */

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
/* "today" only while today's session is ahead or running; after the close it is the next session's. */
export const AGENDA_LINES: Record<AgendaFace, string> = {
  get targets() {
    return `Every strike, in the order it matters ${todayScopeLabel() === 'Today' ? 'today' : 'next session'}`;
  },
  building: 'What the overnight open-interest count added to every strike, and what it took off',
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
