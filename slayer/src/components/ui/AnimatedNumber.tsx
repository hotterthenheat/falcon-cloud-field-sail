import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  /** Formats the in-flight value each frame (e.g. v => `$${v.toFixed(2)}`) */
  format?: (v: number) => string;
  className?: string;
  /** Change stamp: on a new value the ink jumps to bull or bear for a beat, then eases back while the number rolls.
      Opt-in: if every number flashed, none would stand out. */
  flash?: boolean;
}

const FLASH_UP = 'rgb(var(--bull))';
const FLASH_DOWN = 'rgb(var(--bear))';
const FLASH_HOLD_MS = 240;

/**
 * Rolls smoothly between numeric values instead of snapping.
 * Mounts at its initial value (no entrance animation) — pair with `tnum`
 * on the parent so digits don't jitter horizontally while rolling.
 */
const AnimatedNumber = ({ value, format = v => v.toFixed(2), className, flash = false }: AnimatedNumberProps) => {
  const reduced = useReducedMotion();
  const raw = useMotionValue(value);
  const spring = useSpring(raw, { stiffness: 170, damping: 28 });
  const text = useTransform(spring, v => format(v));

  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);
  const prevRef = useRef(value);

  useEffect(() => {
    if (reduced) spring.jump(value);
    else raw.set(value);
  }, [value, reduced, raw, spring]);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (!flash || reduced) return;
    if (Math.abs(value - prev) < 1e-9) return;
    setFlashDir(value > prev ? 'up' : 'down');
    const id = setTimeout(() => setFlashDir(null), FLASH_HOLD_MS);
    return () => clearTimeout(id);
  }, [value, flash, reduced]);

  return (
    <motion.span
      className={`${className ?? ''} ${flash ? 'transition-colors duration-500' : ''}`}
      /* Stamp IN instantly (0ms), ease BACK through the class transition once
         the inline color is removed — back to whatever ink the parent wears. */
      style={
        flashDir
          ? { color: flashDir === 'up' ? FLASH_UP : FLASH_DOWN, transitionDuration: '0ms' }
          : undefined
      }
    >
      {text}
    </motion.span>
  );
};

export default AnimatedNumber;
