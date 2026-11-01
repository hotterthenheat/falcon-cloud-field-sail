/*
==================================================
  SLAYER TERMINAL - THE SWITCH (ui/Switch.tsx)

  The partner tree's (Noah, 2026-10-31: "the on and off should look like a switch with a smooth animation"): a short
  track and a knob that slides across it, 200ms eased, the track taking the silver when on. role="switch" +
  aria-checked, so a reader hears what the knob shows. The knob moves with a transform, so the slide is one compositor
  pass; `motion-reduce` drops the animation. A span, not a button — the ROW that holds it is the control.
==================================================
*/

const Switch = ({ on, className = '' }: { on: boolean; className?: string }) => (
  <span
    role="switch"
    aria-checked={on}
    className={`relative inline-flex shrink-0 w-7 h-4 rounded-full border transition-colors duration-200 ease-out motion-reduce:transition-none ${
      on ? 'bg-silverFill border-silverFill' : 'bg-ink/[0.08] border-borderMuted'
    } ${className}`}
    data-switch={on ? 'on' : 'off'}
  >
    <span
      aria-hidden
      className={`absolute top-[2px] left-[2px] w-[10px] h-[10px] rounded-full transition-transform duration-200 ease-out motion-reduce:transition-none ${
        on ? 'translate-x-3 bg-panel' : 'translate-x-0 bg-textMuted'
      }`}
    />
  </span>
);

export default Switch;
