/* The reader's profile (picture, name, handle, email, sign-in method, sessions) in localStorage, mirrored from the account row while signed in.
   The picture is cropped to a 128 px square. */

import { useSyncExternalStore } from 'react';

export type SignInWay = 'email' | 'google' | 'apple';

export interface Device {
  id: string;
  /** "Windows · Chrome" */
  name: string;
  /** "now", "2 days ago" — the service's words */
  lastSeen: string;
  thisOne: boolean;
}

export interface Profile {
  name: string;
  /** without the @ */
  handle: string;
  email: string;
  /** a data URL, or none — the initials stand in */
  avatar: string | null;
  signIn: SignInWay;
  devices: Device[];
}

const KEY = 'slayer_profile';

/** The sample the preview starts from; a real account replaces it at sign-in. */
export const SAMPLE_PROFILE: Profile = {
  name: 'John Doe',
  handle: 'johndoe',
  email: 'johndoe@example.com',
  avatar: null,
  signIn: 'email',
  /* no invented sessions: the preview knows only the browser it is open in (thisDevice) */
  devices: [],
};

/** This browser, read off its own user agent ("macOS · Chrome") — the one session the preview can vouch for. */
export function thisDevice(): Device {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'This device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { id: 'this', name: `${os} · ${browser}`, lastSeen: 'now', thisOne: true };
}

let profile: Profile = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SAMPLE_PROFILE;
    const p = JSON.parse(raw) as Partial<Profile>;
    /* a profile saved under the old sample's name takes the current placeholder's name and handle */
    const oldSample = p.name === 'Noah' && p.handle === 'noah';
    return {
      ...SAMPLE_PROFILE,
      ...p,
      ...(oldSample ? { name: SAMPLE_PROFILE.name, handle: SAMPLE_PROFILE.handle, email: p.email === 'noah@example.com' ? SAMPLE_PROFILE.email : p.email } : {}),
      devices: [],
    };
  } catch {
    return SAMPLE_PROFILE;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

type ProfileSink = (patch: Partial<Profile>) => void;
let sink: ProfileSink | null = null;
/** While signed in, a change saved here is written to the account row (data/account.ts). */
export const onProfileSaved = (fn: ProfileSink | null): void => {
  sink = fn;
};

export function setProfile(patch: Partial<Profile>): void {
  profile = { ...profile, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage full or off: the change lives for the session */
  }
  listeners.forEach(fn => fn());
  sink?.(patch);
}

export const useProfile = (): Profile => useSyncExternalStore(subscribe, () => profile, () => SAMPLE_PROFILE);

/** Initials for the avatar when there is no picture: "JD" for "John Doe" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join('');
}

/** The reader's file as the picture: a square cover crop at AVATAR_PX, so a multi-MB photo becomes a few KB. */
export const AVATAR_PX = 128;
export function readAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_PX;
        canvas.height = AVATAR_PX;
        const g = canvas.getContext('2d');
        if (!g) throw new Error('no canvas');
        g.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}
