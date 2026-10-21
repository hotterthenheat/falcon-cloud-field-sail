/*
==================================================
  SLAYER TERMINAL - THE READER'S PICTURE (components/ui/Avatar.tsx)

  The picture the reader added on Settings ›
  Account, or their initials on the holo disc
  until they do — one mark for the sidebar's foot,
  the Account page and, later, their posts.

  A PICTURE THAT WILL NOT LOAD FALLS BACK TO THE
  DISC (Noah, 2026-10-14, an empty ring on the
  Account page: "what happened to our icon??"): the
  account's picture can be a URL — Google's, taken
  from the sign-in (supabase/migrations
  20261011_avatar_from_provider.sql) — and a URL
  can die, or be refused. An <img> that fails is a
  bare ring; the initials are never that. The
  request carries no referrer: Google's picture
  host refuses some sites' referrers outright, and
  the picture is the reader's own either way.
==================================================
*/

import { useEffect, useState } from 'react';
import { initials, type Profile } from '../../data/profile';

const Avatar = ({ profile, size, className = '' }: { profile: Profile; size: number; className?: string }) => {
  /* a picture that failed to load — forgotten the moment the picture changes */
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    setBroken(null);
  }, [profile.avatar]);
  const picture = profile.avatar && broken !== profile.avatar ? profile.avatar : null;
  return picture ? (
    <img
      src={picture}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(picture)}
      className={`rounded-full object-cover shrink-0 border border-borderSubtle ${className}`}
      style={{ width: size, height: size }}
      data-avatar="picture"
    />
  ) : (
    <span
      className={`holo-bg rounded-full shrink-0 inline-flex items-center justify-center font-mono font-bold text-[#0a0a0a] select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      data-avatar={profile.avatar ? 'initials-fallback' : 'initials'}
      aria-hidden
    >
      {initials(profile.name)}
    </span>
  );
};

export default Avatar;
