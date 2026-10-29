/* The premium floor every flow page offers: a contract, print or structure is shown only from this many dollars up. */

import type { DropdownOption } from '../ui/DropdownSelect';

export type PremFloor = '0' | '100000' | '1000000' | '10000000';
export const PREM_FLOORS: PremFloor[] = ['0', '100000', '1000000', '10000000'];
export const PREM_FLOOR_OPTIONS: DropdownOption<PremFloor>[] = [
  { value: '0', label: 'Any', hint: 'Whatever the money' },
  { value: '100000', label: '$100K+', hint: 'At least $100K' },
  { value: '1000000', label: '$1M+', hint: 'At least $1M' },
  { value: '10000000', label: '$10M+', hint: 'At least $10M' },
];
