/*
  The Weigher's page: chart, chain and watchlist on one desk, for weighing one contract at a time.
*/

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import WeigherDesk, { type WeighRequest } from './weigher/WeigherDesk';

const Weigher = () => {
  const location = useLocation();

  /* Trace's print drilldown jumps here with a name to weigh; the Record's busiest rows with a CONTRACT. Read ONCE
     and consumed from history, the Compass pattern — a refresh must not drag the desk back to a name the user has
     since moved off. The way back (`wayBack`) is the shell's and stays in the state. */
  const [incoming, setIncoming] = useState<WeighRequest | null>(null);
  useEffect(() => {
    const state = location.state as { weigh?: WeighRequest; wayBack?: string } | null;
    if (state?.weigh?.ticker) {
      setIncoming(state.weigh);
      window.history.replaceState(state.wayBack ? { wayBack: state.wayBack } : {}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    /* No PageHeader at all: the desk's own strip carries the identity, fused onto the same line as the session
       pill. */
    <WeigherDesk incoming={incoming} />
  );
};

export default Weigher;
