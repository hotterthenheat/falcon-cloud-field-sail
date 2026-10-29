/* A contract named in a sentence wears the contract cell's silver hover and opens the same card; inline and
   baseline-aligned. */

import type { ReactNode } from 'react';
import { DOOR, DOOR_HOVER_TEXT } from './door';

const ReadDoor = ({
  onOpen,
  title = 'Open the in-depth review',
  children,
}: {
  onOpen: () => void;
  title?: string;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onOpen}
    title={title}
    className={`inline align-baseline font-semibold text-textPrimary pb-[1px] ${DOOR} ${DOOR_HOVER_TEXT}`}
  >
    {children}
  </button>
);

export default ReadDoor;
