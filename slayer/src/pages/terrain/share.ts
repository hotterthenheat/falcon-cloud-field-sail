/** A desk copied into the hash. Levels are whatever the book had; null means it had none. */
export interface SharePayload {
  t: string;
  tf: string;
  overlays: Record<string, boolean>;
  levels: {
    spot: number;
    flip: number | null;
    callWall: number | null;
    putWall: number | null;
    supreme: number;
    scope: string;
  } | null;
}

function toB64(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeShare(p: SharePayload): string {
  return '#' + toB64(JSON.stringify(p));
}

export function decodeShare(hash: string): SharePayload | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    const o = JSON.parse(fromB64(raw)) as SharePayload;
    if (!o || typeof o.t !== 'string' || typeof o.tf !== 'string' || !o.overlays || typeof o.overlays !== 'object') return null;
    return o;
  } catch {
    return null;
  }
}
