/* The contract door, defined once: every door on Trace answers the pointer with the holographic silver, no
   underline. */

/** The door at rest and its motion; its own line-height keeps it 21px inside a 39px grid row. */
export const DOOR = 'leading-normal transition-colors';

/** The name's hover ink — on the element the pointer lands on. */
export const DOOR_HOVER_TEXT = 'hover:text-silver';

/** The same ink for a name inside a hovered door (the cell is `group/door`). */
export const DOOR_GROUP_TEXT = 'group-hover/door:text-silver transition-colors';
