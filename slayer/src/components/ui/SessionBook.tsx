import DropdownSelect from './DropdownSelect';
import { DESK_SESSIONS, followDeskClock, sessionMeta, setDeskSession, useDeskFollowsClock, useDeskSession, type DeskSession } from '../../data/deskSession';

/* Which session the book is read in: the clock's, unless the reader pins one; Follow gives the pin back. */
type Choice = DeskSession | 'clock';

const SessionBook = () => {
  const session = useDeskSession();
  const follows = useDeskFollowsClock();
  const live = sessionMeta(session);
  const options = [
    { value: 'clock' as const, label: `Follow · ${live.label}`, hint: `Moves on its own. Right now ${live.window}.` },
    ...DESK_SESSIONS.map(s => ({ value: s.value, label: s.label, hint: `${s.window} · ${s.hint}. Stays until you follow the clock.` })),
  ];
  return (
    <DropdownSelect<Choice>
      label="Session"
      value={follows ? 'clock' : session}
      options={options}
      onChange={next => (next === 'clock' ? followDeskClock() : setDeskSession(next))}
      title={follows ? `Following the clock. ${live.label}, ${live.window}. Pick a session to hold it.` : `Held on ${live.label}. Follow the clock to let it move.`}
      testId="desk-session"
      align="end"
    />
  );
};

export default SessionBook;