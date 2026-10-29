/*
  The path a proxy forwards, taken from req.url. A path that the URL parser would rewrite (dot segments, encoded
  or not; backslashes; empty segments) is refused. Encoded slashes inside a name stay encoded upstream, so the allowlist always matches what goes upstream.
*/

/** Strips `prefix` and returns '/rest?query', or null when the path is unsafe. */
export function forwardPath(rawUrl, prefix, maxLength) {
  let p = (rawUrl || '/').replace(prefix, '') || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length >= maxLength) return null;
  const q = p.indexOf('?');
  const pathPart = q === -1 ? p : p.slice(0, q);
  if (pathPart.includes('\\') || pathPart.includes('//')) return null;
  for (const seg of pathPart.split('/').slice(1)) {
    let plain;
    try {
      plain = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (plain === '.' || plain === '..') return null;
  }
  try {
    if (new URL(`https://upstream.invalid/base${pathPart}`).pathname !== `/base${pathPart}`) return null;
  } catch {
    return null;
  }
  return p;
}
