/* A desk DeskKeep has left up stays mounted so coming back is instant. It is not on screen.
   Readers of this context ask for nothing and do not rebuild while it is false. Pages outside a kept desk read true. */
import { createContext, useContext } from 'react';

export const DeskAwakeContext = createContext(true);

export function useDeskAwake(): boolean {
  return useContext(DeskAwakeContext);
}
