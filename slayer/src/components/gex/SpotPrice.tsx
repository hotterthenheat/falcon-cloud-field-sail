import AnimatedNumber from '../ui/AnimatedNumber';

/** Live spot with the house change stamp: red on a drop, green on a rise, easing back to white while the number rolls (AnimatedNumber). */
const SpotPrice = ({
  value,
  className = 'font-mono text-t11 font-semibold tnum text-textPrimary',
}: {
  value: number;
  className?: string;
}) => <AnimatedNumber value={value} format={v => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} flash className={className} />;

export default SpotPrice;
