/* The compiled scripts the alert watcher runs, cached by id; the editor forgets one when its source changes. Its own
   module, so the editor does not pull the watcher in. */

import { builtinScripts } from '../../data/builtinScripts';
import { scriptStore } from '../../data/scriptStore';
import { compile, type Compiled } from '../../core/pine';

/* A script alert runs the script the way its pane does — over the name's bars on its timeframe, with the
   placement's inputs and the book in `slayer.*` — and reads the condition's flag on the last bar. Compiles are
   cached by id; a script that does not compile is remembered as null and left alone. */
const compiledById = new Map<string, Compiled | null>();
const fetching = new Set<string>();
export const compileOf = (scriptId: string, poke: () => void): Compiled | null | undefined => {
  if (compiledById.has(scriptId)) return compiledById.get(scriptId);
  const builtin = builtinScripts().find(s => s.id === scriptId);
  if (builtin) {
    try {
      compiledById.set(scriptId, compile(builtin.source));
    } catch {
      compiledById.set(scriptId, null);
    }
    return compiledById.get(scriptId);
  }
  if (!fetching.has(scriptId)) {
    fetching.add(scriptId);
    void scriptStore.get(scriptId).then(s => {
      try {
        compiledById.set(scriptId, s ? compile(s.source) : null);
      } catch {
        compiledById.set(scriptId, null);
      }
      fetching.delete(scriptId);
      poke();
    });
  }
  return undefined;
};

/** A saved script changed under an alert — forget its compile so the next tick re-reads it */
export const forgetCompiled = (scriptId: string): void => {
  compiledById.delete(scriptId);
};

