/*
  One bell for every place an alert is set. When its count rises it is kicked and swings back on an underdamped
  framer-motion spring with a small pop, landing in the alert ink, which it keeps while anything is set. Quiet, it
  takes the host's colour. Reduced motion gets the ink without the swing.
*/

import { useEffect, useRef, type CSSProperties } from 'react';
import { Bell } from 'lucide-react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { jingle } from '../../core/sound';
import PageGlyph from './PageGlyph';

interface JingleBellProps {
  /** How many are set — a rise rings, more than none wears the ink */
  count: number;
  /** The ink worn while set (the alert orange by default) */
  ink?: string;
  /** Wear the ink even with nothing set (a bell whose menu is open) */
  lit?: boolean;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  /** Draw the Alerts page glyph (ui/PageGlyph.tsx) instead of the line bell, as in the rail and phone menu. */
  glyph?: number;
}

const JingleBell = ({ count, ink = 'rgb(var(--warn))', lit = false, className = '', strokeWidth, style, glyph }: JingleBellProps) => {
  const prev = useRef(count);
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  useEffect(() => {
    /* a rise RINGS — out loud when the desk allows it (Settings › The desk),
       whatever the motion setting says */
    if (count > prev.current) jingle();
    if (count > prev.current && !reduce) {
      /* the kick, then the spring home: stiff enough to swing fast, damped
         lightly enough to cross zero three or four times before it rests */
      controls.set({ rotate: 22 });
      void controls.start({
        rotate: 0,
        scale: [1, 1.16, 1],
        transition: {
          rotate: { type: 'spring', stiffness: 380, damping: 5.5, mass: 0.7 },
          scale: { duration: 0.42, ease: 'easeOut' },
        },
      });
    }
    prev.current = count;
  }, [count, controls, reduce]);
  const armed = count > 0;
  return (
    <motion.span animate={controls} className="inline-flex shrink-0" style={{ transformOrigin: '50% 8%' }} aria-hidden data-bell={armed ? 'armed' : 'quiet'}>
      {glyph ? (
        <PageGlyph name="alerts" size={glyph} className={className} />
      ) : (
      <Bell
        className={className}
        strokeWidth={strokeWidth}
        style={{
          ...style,
          color: armed || lit ? ink : style?.color,
          /* the ink lands as the swing settles; leaving it is immediate */
          transition: `color 0.25s ease ${armed ? '0.45s' : '0s'}`,
        }}
      />
      )}
    </motion.span>
  );
};

export default JingleBell;
