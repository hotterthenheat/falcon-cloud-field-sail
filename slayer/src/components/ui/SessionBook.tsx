import DropdownSelect from './DropdownSelect';
import { DESK_SESSIONS, setDeskSession, useDeskSession, type DeskSession } from '../../data/deskSession';

/*
  Which session the book is being read in. One control, the house dropdown,
  so it sits in a shell head beside the other cards (Ruler, Levels) and
  every desk that mounts it reads the same session.
*/
const OPTIONS = DESK_SESSIONS.map(s => ({ value: s.value, label: s.label, hint: `${s.window} · ${s.hint}` }));

const SessionBook = () => {
  const session = useDeskSession();
  return (
    <DropdownSelect<DeskSession>
      label="Session"
      value={session}
      options={OPTIONS}
      onChange={setDeskSession}
      title="Which hours the day's price is read in. The book of strikes stays the cash session."
      testId="desk-session"
      align="end"
    />
  );
};

export default SessionBook;
