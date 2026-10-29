/* One name's same-day options: its expiring contracts by the day's premium, with the name's same-day net from the
   vendor's flow by expiry. The 0DTE page's search opens it. */

import { useCallback, useMemo, useState } from 'react';
import { fmtCount as num, usd as fmtUsd, useFlowPerExpiry, useSameDayBook } from '../../data/traceLive';
import { bookLeanWords, notABet } from '../../data/flowBook';
import type { BookContract } from '../../types/trace';
import type { Column } from '../ui/DataTable';
import CompanyLogo from '../ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import BookDrill from './BookDrill';
import ContractCell from './ContractCell';
import Lean from './Lean';
import LeanCell from './LeanCell';
import { SessionMark } from './LiveHold';
import { matchesContract, normSymbol } from './FlowSearch';
import { PREM_FLOOR_OPTIONS, type PremFloor } from './premFloor';
import TraceBox, { endlessOf, Fact, PhoneRow, TraceGrid } from './TraceBox';
import WatchStar from './WatchStar';
import { contractKey, watchContract } from '../../context/WatchContext';
import { shortDay } from './dayWords';

type Right = 'ALL' | 'C' | 'P';
const RIGHT_OPTIONS: DropdownOption<Right>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
const WIDTHS: Record<string, number> = { time: 84, ticker: 84, contract: 132, last: 84, vol: 92, oi: 84, prem: 92, lean: 132 };
const keyOf = (r: BookContract) => r.key;
const PIN_RIGHT = ['prem'];

const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />}
    title={
      <>
        <CompanyLogo ticker={r.ticker} size={15} />
        <span className="font-bold">{r.ticker}</span>
        <span className="font-bold tnum">{r.strike}</span>
        <span className={r.right === 'C' ? 'text-bull' : 'text-bear'}>{r.right === 'C' ? 'call' : 'put'}</span>
      </>
    }
    aside={`${r.lastAt} ET`}
    figures={[
      <span key="p" className="font-semibold text-textPrimary">
        {fmtUsd(r.premium)}
      </span>,
      <span key="v">{num(r.volume)} vol</span>,
      <span key="l">{bookLeanWords(r)}</span>,
    ]}
  />
);

const SameDayName = ({ name, iso, query }: { name: string; iso: string; query: string }) => {
  const pack = useSameDayBook(name, iso);
  const fpe = useFlowPerExpiry(name);
  const day = useMemo(() => fpe.rows.find(e => e.expiry === iso) ?? null, [fpe.rows, iso]);
  const [right, setRight] = useState<Right>('ALL');
  const [prem, setPrem] = useState<PremFloor>('0');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openRow = useCallback((r: BookContract) => setOpenKey(r.key), []);
  const contractQ = normSymbol(query) !== normSymbol(name) ? query : '';
  const rows = useMemo(() => {
    const floor = Number(prem);
    return pack.rows.filter(r => (right === 'ALL' || r.right === right) && r.premium >= floor && (contractQ === '' || matchesContract(contractQ, r)));
  }, [pack.rows, right, prem, contractQ]);
  const bets = useMemo(() => rows.filter(r => !notABet(r)), [rows]);
  const prem$ = bets.reduce((a, r) => a + r.premium, 0);
  const reading = pack.waiting && pack.rows.length === 0;
  const columns = useMemo<Column<BookContract>[]>(
    () => [
      {
        key: 'time',
        header: 'Time ET',
        sortValue: r => r.lastAtMin,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />
            <span className="text-t11 text-textPrimary">{r.lastAt}</span>
          </span>
        ),
      },
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={r.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.ticker}</span>
          </span>
        ),
      },
      { key: 'contract', header: 'Contract', align: 'right', sortValue: r => r.strike, render: r => <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} /> },
      { key: 'last', header: 'Last fill', align: 'right', sortValue: r => r.last, render: r => <span className="text-textPrimary">${r.last.toFixed(2)}</span> },
      { key: 'vol', header: 'Vol', align: 'right', sortValue: r => r.volume, render: r => <span className="text-textPrimary">{num(r.volume)}</span> },
      { key: 'oi', header: 'OI', align: 'right', sortValue: r => r.oi, render: r => <span className="text-textPrimary">{num(r.oi)}</span> },
      { key: 'lean', header: 'Lean', align: 'right', sortValue: r => r.askPct, render: r => <LeanCell askPct={r.askPct} split={r.sideVol} legsPct={r.multiPct} crossPct={r.crossPct} /> },
      { key: 'prem', header: 'Prem', align: 'right', sortValue: r => r.premium, render: r => <span className="font-semibold text-textPrimary">{fmtUsd(r.premium)}</span> },
    ],
    []
  );
  return (
    <>
      <TraceBox
        title={`${name} same-day`}
        sub={`${name}'s contracts expiring ${shortDay(iso)}, by the day's premium · a row opens its card`}
        testId="odte-name"
        className="mt-3"
        foldOnPhone
        data={{ name, rows: rows.length }}
        facts={
          <>
            <Fact label="Net calls" testId="name-calls" title="Same-day call premium at the ask less on the bid (the vendor's flow by expiry)">
              {day ? <Lean v={day.callNet} /> : <span className="text-textMuted">{fpe.waiting ? '…' : '—'}</span>}
            </Fact>
            <Fact label="Net puts" testId="name-puts" title="Same-day put premium at the ask less on the bid">
              {day ? <Lean v={day.putNet} put /> : <span className="text-textMuted">{fpe.waiting ? '…' : '—'}</span>}
            </Fact>
            <Fact label="Volume" testId="name-vol">
              {day ? (
                <>
                  {num(day.callVol + day.putVol)} <span className="text-textSecondary">· calls {num(day.callVol)} · puts {num(day.putVol)}</span>
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            <Fact label="On this cut" testId="name-prem" title="Single bets only: packages, spread legs and crosses are left out">
              {reading ? <span className="text-textMuted">…</span> : <>{fmtUsd(prem$)} <span className="text-textSecondary">· {num(bets.length)} contracts</span></>}
            </Fact>
          </>
        }
        controls={
          <>
            <SessionMark at={pack.at} fault={pack.fault} kept={pack.kept} />
            <DropdownSelect label="Type" value={right} options={RIGHT_OPTIONS} onChange={setRight} title="Calls, puts or both" testId="odte-name-type" />
            <DropdownSelect label="Premium" value={prem} options={PREM_FLOOR_OPTIONS} onChange={setPrem} title="The least money a contract carried" testId="odte-name-premium" />
          </>
        }
        sentence={null}
      >
        <TraceGrid
          rows={rows}
          columns={columns}
          widths={WIDTHS}
          rowKey={keyOf}
          onRowClick={openRow}
          selectedKey={openKey}
          phoneRow={phoneRow}
          pinRight={PIN_RIGHT}
          autoHeight
          endless={endlessOf(pack.older, 'contracts', 'every same-day contract read', false, 'Load more ↓')}
          emptyText={reading ? 'Reading the same-day book…' : pack.fault && pack.rows.length === 0 ? 'This read did not land — it fills when the feed answers' : `No ${name} contracts expiring ${shortDay(iso)} on this cut`}
          testId="odte-name"
        />
      </TraceBox>
      <BookDrill list={rows} openKey={openKey} onOpen={setOpenKey} />
    </>
  );
};

export default SameDayName;
