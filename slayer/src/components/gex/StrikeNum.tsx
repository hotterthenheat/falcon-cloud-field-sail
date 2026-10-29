/* A strike set flush right in the matrix and calendar: in a book with half-dollar strikes the whole ones carry an invisible ".00",
   so "255" and "257.50" line up on the point. */

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
