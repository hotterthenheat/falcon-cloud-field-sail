/*
==================================================
  SLAYER TERMINAL - A STRIKE, SET FOR A RIGHT-ALIGNED COLUMN (components/gex/StrikeNum.tsx)

  The matrix and the calendar set their strikes flush right, against the
  first figure or capsule (the owner, 2026-10-13: "close this gap … i
  dont want any empty or unutilized spacing"). In a book with half-dollar
  strikes the whole ones carry an invisible ".00", so "255" and "257.50"
  line up on the point rather than on the last digit.
==================================================
*/

const fmt = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/** Does this book list any strike off the dollar? */
export const hasCents = (strikes: number[]): boolean => strikes.some(s => s % 1 !== 0);

const StrikeNum = ({ v, cents }: { v: number; cents: boolean }) => {
  const s = fmt(v);
  if (!cents) return <>{s}</>;
  const [whole, part] = s.split('.');
  return (
    <>
      {whole}
      <span className={part ? undefined : 'invisible'}>.{part ?? '00'}</span>
    </>
  );
};

export default StrikeNum;
