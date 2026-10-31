/* shadcn's `cn`, as far as the copied components use it: class strings and { class: condition } maps, joined. (No
   tailwind-merge: the copied components never pass two classes for one property.) */
type ClassValue = string | false | null | undefined | Record<string, boolean | undefined>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (typeof v === 'string') out.push(v);
    else for (const [k, on] of Object.entries(v)) if (on) out.push(k);
  }
  return out.join(' ');
}
