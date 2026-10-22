import { useCompanyName } from '../../data/liveFiles';

/** The company's name under a ticker: the vendor's own (its stock info), the bundled listing's until that lands, else
    the fallback — never the ticker said twice (the re-audit, 2026-10-22: the listing called SERV "ServiceMaster") */
export const CoSub = ({ ticker, fallback, className = 'text-[10px] text-textMuted truncate', vendor = true }: { ticker: string; fallback?: string | null; className?: string; /** the symbol came off a vendor feed, so the vendor knows it */ vendor?: boolean }) => {
  const n = useCompanyName(ticker, vendor);
  const v = n && n.toUpperCase() !== ticker.toUpperCase() ? n : fallback && fallback.toUpperCase() !== ticker.toUpperCase() ? fallback : '';
  return v ? (
    <span className={className} title={v}>
      {v}
    </span>
  ) : null;
};
