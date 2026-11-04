import AnimatedNumber from '../ui/AnimatedNumber';
import { fmtPx } from '../../core/format';

/** Live spot with the house change stamp: red on a drop, green on a rise, easing back to white while the number rolls (AnimatedNumber). */
const SpotPrice = ({
  value,
  className = 'font-mono text-t11 font-semibold tnum text-textPrimary',
}: {
  value: number;
  className?: string;
}) => <AnimatedNumber value={value} format={v => `$${fmtPx(v)}`} flash className={className} />;

export default SpotPrice;
