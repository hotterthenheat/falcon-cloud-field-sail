/*
  The whole contract in its side's ink with its logo: the mark, then one pill with name, strike and side (bull for a
  call, bear for a put), a hairline border and a faint tint. Every surface that prints a contract uses this.
*/

import CompanyLogo from './CompanyLogo';

interface ContractLabelProps {
  /** e.g. "NVDA 112.50C" */
  contract: string;
  right: 'C' | 'P';
  /** The name's mark before the pill (the global rule: a ticker travels with its logo) */
  logo?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const ContractLabel = ({ contract, right, logo, size = 'md', className = '' }: ContractLabelProps) => {
  const isCall = right === 'C';
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`} data-contract-label={contract}>
      {logo && <CompanyLogo ticker={logo} size={size === 'sm' ? 14 : 16} />}
      {/* leading-normal is explicit: inside a grid cell the pill inherited the row's line-height and overflowed it */}
      <span className={`font-mono font-bold leading-normal rounded border whitespace-nowrap ${size === 'sm' ? 'text-t11 px-1 py-px' : 'text-t12 px-1.5 py-0.5'} ${isCall ? 'text-bull border-bull/30 bg-bull/[0.06]' : 'text-bear border-bear/30 bg-bear/[0.06]'}`}>{contract}</span>
    </span>
  );
};

export default ContractLabel;
