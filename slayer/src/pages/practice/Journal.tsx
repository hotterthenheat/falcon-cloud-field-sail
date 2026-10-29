/* PRACTICE › JOURNAL — one page, many journals: every paper account's trades, one account's, the backtest sessions'
   (all or one), or a journal of the reader's own entries — never mixed. Which one rides the address
   (`?journal=paper:<id>`, data/review/journalBooks.ts; every paper account by rest; the older `?book=backtest&session=`
   still reads). The pages are pages/review/JournalHome.tsx (the app's measured trades) and JournalManual.tsx (yours). */
import { useLocation } from 'react-router-dom';
import { JournalHome } from '../review/JournalHome';
import { JournalManualHome } from '../review/JournalManual';
import { pickOf } from '../../data/review/journalBooks';

const PracticeJournal = () => {
  const location = useLocation();
  const pick = pickOf(location.search);
  return pick.book === 'manual' ? <JournalManualHome /> : <JournalHome kind={pick.book} />;
};

export default PracticeJournal;
