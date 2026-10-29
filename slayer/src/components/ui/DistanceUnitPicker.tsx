import { DISTANCE_UNITS } from '../../data/atr';
import { setDistanceUnit, useDistanceUnit } from '../../data/distanceUnits';

/* One desk-wide distance unit, four chips: every surface that prints a distance reads the same one. */

const UNIT_WORDS: Record<string, string> = {
  $: 'dollars',
  '%': 'percent of spot',
  ATR: 'average true ranges — the same distance on SPY and on NVDA',
  σ: 'implied one-day moves — how many σ the options price',
};

const DistanceUnitPicker = ({ dense = false }: { dense?: boolean }) => {
  const unit = useDistanceUnit();
  return (
    <div
      role="group"
      aria-label="Distance unit — desk-wide"
      className={`inline-flex items-center rounded border border-borderSubtle overflow-hidden ${dense ? '' : 'ml-auto'}`}
    >
      {DISTANCE_UNITS.map(u => (
        <button
          key={u}
          onClick={() => setDistanceUnit(u)}
          aria-pressed={unit === u}
          title={`Distances in ${UNIT_WORDS[u]}`}
          className={`px-1.5 h-[20px] font-mono text-t10 tnum transition-colors ${
            unit === u ? 'bg-ink/[0.10] text-textPrimary font-semibold' : 'text-textMuted hover:text-textPrimary'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
};

export default DistanceUnitPicker;
