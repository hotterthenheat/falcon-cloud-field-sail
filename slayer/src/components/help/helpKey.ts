/* The "?" key: opens and closes the help sheet (HelpSheet.tsx) from anywhere a field is not taking the key. Kept out of
   the sheet's own chunk so the shell can listen before the sheet's code is loaded. */

import { useEffect } from 'react';
import { toggleHelp } from '../../data/overlayDoors';

/** Is the key meant for a field (typing a "?" into a search, a note, the script editor)? */
const typing = (t: EventTarget | null): boolean => {
  const el = t instanceof HTMLElement ? t : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return !!el.closest('.cm-editor, [role="textbox"], [role="combobox"]');
};

/** "?" opens and closes the sheet, from anywhere a field is not taking the key */
export const useHelpKey = (): void => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return;
      if (typing(e.target)) return;
      e.preventDefault();
      toggleHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};
