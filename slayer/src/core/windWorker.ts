/* The wind field's worker: runs core/windField.ts off the main thread, one ask in, one field out, the buffers handed over
   rather than copied. The pool (core/windPool.ts) owns it. */
import { runWind, type WindField, type WindInputs } from './windField';

export type WindAsk = { id: number; inputs: WindInputs };
export type WindReply = { id: number; field: WindField };

const scope = globalThis as unknown as {
  postMessage: (m: WindReply, t: Transferable[]) => void;
  onmessage: ((e: MessageEvent<WindAsk>) => void) | null;
};
scope.onmessage = e => {
  const { id, inputs } = e.data;
  const field = runWind(inputs);
  scope.postMessage({ id, field }, [field.density.cells.buffer, field.streams.cells.buffer]);
};
