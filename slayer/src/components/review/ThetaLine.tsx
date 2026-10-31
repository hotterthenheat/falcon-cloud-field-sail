/* PRACTICE · the one line a desk wears while ThetaData is not answering: what is away, and how old what is on screen is.
   Nothing fills while it shows. */

import { FailLine } from '../ui/states';

const ThetaLine = ({ since, at, what = 'Live data offline — reconnecting', className = '' }: { since: number; at?: number | null; what?: string; className?: string }) =>
  since > 0 ? <FailLine what={what} at={at ?? since} className={`px-1 ${className}`} /> : null;

export default ThetaLine;
