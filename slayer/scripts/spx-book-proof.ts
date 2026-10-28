/*
  The SPX book is the only tape Terrain may draw. This checks the file on
  disk: every timeframe has bars, the rank is a year of VIX, the cones and
  the scorecard are present, and the flow is yesterday's SPXW prints.
*/
import { readFileSync } from 'node:fs';
import { barsForRead, buildRead, flowBuckets, type RawBook } from '../src/data/spxFacts';

const raw = JSON.parse(readFileSync(new URL('../public/books/spx.json', import.meta.url), 'utf8')) as RawBook;
const book = buildRead(raw);
const fail: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) fail.push(msg);
  else console.log('ok', msg);
};

check(book.minute.length >= 390, `1m ${book.minute.length}`);
check(book.sec15.length >= 1500, `15s ${book.sec15.length}`);
check(book.daily.length >= 200, `daily ${book.daily.length}`);
check(book.weekly.length >= 40, `weekly ${book.weekly.length}`);
check(barsForRead(book, 5).length > 50, `5m ${barsForRead(book, 5).length}`);
check(barsForRead(book, 15).length > 20, `15m ${barsForRead(book, 15).length}`);
check(barsForRead(book, 30).length > 10, `30m ${barsForRead(book, 30).length}`);
check(barsForRead(book, 60).length > 5, `1h ${barsForRead(book, 60).length}`);
check(barsForRead(book, 0.25) === book.sec15, '15s is not a resampled minute');
check(book.ivSessions >= 250, `iv sessions ${book.ivSessions}`);
check(book.ivRank != null && book.ivRank >= 0 && book.ivRank <= 100, `iv rank ${book.ivRank}`);
check(book.sessionIv != null && book.sessionIv > 0.08 && book.sessionIv < 0.8, `session iv ${book.sessionIv}`);
check(book.cones.session != null && book.cones.session.move > 20, `session move ${book.cones.session?.move}`);
check(book.cones.week != null && book.cones.week.move > book.cones.session!.move, `week move ${book.cones.week?.move}`);
check(book.cones.next != null && book.cones.next.move > 20, `next move ${book.cones.next?.move}`);
check(book.scoreOf === 20, `scorecard ${book.scoreOf}`);
check(book.flowMinutes.length >= 380, `flow minutes ${book.flowMinutes.length}`);
check(flowBuckets(book, 60).length > 300, `flow buckets ${flowBuckets(book, 60).length}`);
check(book.bookRail.levels.callWall > 0 && book.bookRail.levels.putWall > 0, `walls ${book.bookRail.levels.callWall} ${book.bookRail.levels.putWall}`);
check(book.bookRail.levels.supreme > 0, `supreme ${book.bookRail.levels.supreme}`);
check(book.spot > 1000, `spot ${book.spot}`);
check(book.changePct != null, `change ${book.changePct}`);
check(book.byExpiry.size >= 2, `expiries ${book.byExpiry.size}`);
check(book.skew != null && Math.abs(book.skew.points) < 20, `skew ${book.skew?.points} ${book.skew?.expires}`);
check(!!book.skew && book.skew.callStrike > book.spot && book.skew.putStrike < book.spot, `skew strikes ${book.skew?.putStrike} ${book.skew?.callStrike}`);
const callNeg = [...book.bookRail.legs.values()].some(l => l.call < 0);
const putPos = [...book.bookRail.legs.values()].some(l => l.put > 0);
check(callNeg && putPos, 'house sign: calls negative, puts positive');
console.log(book.line);
console.log('regime', book.regime, 'pin', book.pin, 'flip', book.bookRail.levels.flip);
if (fail.length) {
  console.error(fail.join('\n'));
  process.exit(1);
}
console.log('spx book ok');
