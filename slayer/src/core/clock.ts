/* The engine clock: the wall clock live; a replay harness pins it so dayKey seeding and expiry resolution follow the historical moment.
   Engine code must read now() here, never a bare new Date(). */

let injected: (() => Date) | null = null;

/** What time the ENGINE thinks it is. Wall clock unless a harness pinned it. */
export function now(): Date {
  return injected ? injected() : new Date();
}

/** Pin the engine clock (replay harness only — never call from UI code). */
export function setEngineClock(fn: (() => Date) | null): void {
  injected = fn;
}

/** Run fn with the clock pinned to `at`, restoring afterwards even on throw. */
export function withEngineClock<T>(at: Date, fn: () => T): T {
  const prev = injected;
  injected = () => at;
  try {
    return fn();
  } finally {
    injected = prev;
  }
}
