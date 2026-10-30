import DropdownSelect from './DropdownSelect';
import { DESK_SESSIONS, followDeskClock, sessionMeta, setDeskSession, useDeskFollowsClock, useDeskSession, type DeskSession } from '../../data/deskSession';

/* Which session the book is read in: the clock's, unless the reader pins one; Follow gives the pin back. */
type Choice = DeskSession | 'clock';

const SessionBook = () => {
  const session = useDeskSession();
  const follows = useDeskFollowsClock();
  const live = sessionMeta(session);
  const options = [
    { value: 'clock' as const, label: `Follow · ${live.label}`, hint: `The session the clock is in. Right now ${live.window}.` },
    ...DESK_SESSIONS.map(s => ({ value: s.value, label: s.label, hint: `${s.window} · ${s.hint}. Lets go when the clock leaves the session this was picked in.` })),
  ];
  return (
    <DropdownSelect<Choice>
      label="Session"
      value={follows ? 'clock' : session}
      options={options}
      onChange={next => (next === 'clock' ? followDeskClock() : setDeskSession(next))}
      title={follows ? `Following the clock. ${live.label}, ${live.window}.` : `Looking at ${live.label}. The site follows again when the clock leaves the session this was picked in.`}
      testId="desk-session"
      align="end"
    />
  );
};

export default SessionBook;