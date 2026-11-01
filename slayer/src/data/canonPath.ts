/* ONE SPELLING PER REQUEST (audit D12): a path's query parameters sorted by name, so two readers that spell the same
   read in a different order share one browser cache entry, one request in flight and one copy in the server's hub.
   The order of a repeated parameter's values (expirations[]=…) is kept: the sort is stable and by name only. */
export function canonPath(path: string): string {
  const q = path.indexOf('?');
  if (q < 0) return path;
  const parts = path.slice(q + 1).split('&').filter(Boolean);
  if (parts.length < 2) return path;
  const name = (p: string) => {
    const i = p.indexOf('=');
    return i < 0 ? p : p.slice(0, i);
  };
  const sorted = parts.map((p, i) => ({ p, i })).sort((a, b) => (name(a.p) < name(b.p) ? -1 : name(a.p) > name(b.p) ? 1 : a.i - b.i)).map(x => x.p);
  return `${path.slice(0, q)}?${sorted.join('&')}`;
}
