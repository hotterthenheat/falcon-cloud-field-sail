/* Draws nothing. Rendered in a Suspense fallback, it reports a load so the mark shows Loading past 450 ms
   (brand/markState.ts). */

import { useEffect } from 'react';
import { beginLoad } from './markState';

const MarkLoad = () => {
  useEffect(() => beginLoad(), []);
  return null;
};

export default MarkLoad;
