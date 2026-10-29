/* The reader's picture, or initials on the holo disc. A picture that fails to load falls back to the initials;
   no referrer is sent, which some picture hosts require. */

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
      className={`relative foil-glide holo-bg rounded-full shrink-0 inline-flex items-center justify-center font-mono font-bold text-onfoil select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      data-avatar={profile.avatar ? 'initials-fallback' : 'initials'}
      aria-hidden
    >
      {initials(profile.name)}
    </span>
  );
};

export default Avatar;
