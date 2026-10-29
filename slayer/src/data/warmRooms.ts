/*
  Prefetches a room's code when a pointer or focus lands on its rail link, so the page opens without a chunk wait.
  Only code: no feed starts until the page itself opens, and nothing is fetched on idle.
*/

const once = new Map<string, Promise<unknown>>();

function go(key: string, load: () => Promise<unknown>) {
  let job = once.get(key);
  if (!job) {
    job = load().catch(() => undefined);
    once.set(key, job);
  }
  return job;
}

const warmPinpoint = () => go('pinpoint', () => Promise.all([import('../pages/pinpoint/PinpointLayout'), import('../pages/pinpoint/MapDesk')]));
const warmDossier = () => go('dossier', () => Promise.all([import('../pages/record/RecordLayout'), import('../pages/record/News')]));

/** A rail link is about to be followed. */
export function warmPath(path: string) {
  if (path.startsWith('/pinpoint')) void warmPinpoint();
  else if (path.startsWith('/dossier') || path.startsWith('/record')) void warmDossier();
}
