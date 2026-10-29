import FilterTabs from './FilterTabs';

interface SegmentedControlProps<V extends string> {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel?: string;
}

/** Alias of FilterTabs for older call sites; new code imports FilterTabs. */
const SegmentedControl = <V extends string>(props: SegmentedControlProps<V>) => <FilterTabs {...props} />;

export default SegmentedControl;
