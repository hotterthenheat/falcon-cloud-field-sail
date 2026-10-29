import { CONTROLS_LINE } from '../trace/TraceBox';

/*
  The three statements under a name. There is no statement feed on this
  desk, so the panel stays empty. It does not invent a quarter.
*/

const Statements = ({ ticker }: { ticker: string }) => (
  <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-statements={ticker}>
    <div className="px-5 pt-4 pb-3">
      <h3 className="text-t15 font-semibold leading-tight text-textPrimary">The statements</h3>
      <p className="mt-0.5 text-t11 text-textMuted">Income, the balance sheet, and cash flow.</p>
    </div>
    <div className={`px-5 pb-2 ${CONTROLS_LINE}`} />
    <p className="px-5 pb-5 text-t12 leading-relaxed text-textSecondary">No statement on this feed.</p>
  </div>
);

export default Statements;
