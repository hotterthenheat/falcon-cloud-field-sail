/* A contract named in a sentence wears the contract cell's silver hover and opens the same card; inline and
   baseline-aligned. hit-24: a 19px word still takes a 24px hit area at a desk and 44 on a phone; z-[1] keeps that box over
   the row drawn after the sentence (a box's controls or its grid), which used to cover the word's lower half (the
   last-targets pass, 2026-10-30). `className` is for a sentence that strings doors together (DarkPool's leaders). */

import type { ReactNode } from 'react';
import { DOOR, DOOR_HOVER_TEXT } from './door';

const ReadDoor = ({
  onOpen,
  title = 'Open the in-depth review',
  children,
  className = '',
}: {
  onOpen: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onOpen}
    title={title}
    className={`hit-24 z-[1] inline align-baseline font-semibold text-textPrimary pb-[1px] ${DOOR} ${DOOR_HOVER_TEXT} ${className}`}
  >
    {children}
  </button>
);

export default ReadDoor;
