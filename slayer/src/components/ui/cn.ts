/** Join class names. Falsy parts are dropped. No extra dependency. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type VariantMap = Record<string, Record<string, string>>;

/** Small CVA stand-in: base plus one class string per variant key. */
export function cva(base: string, config: { variants: VariantMap; defaultVariants?: Record<string, string> }) {
  return (opts?: Record<string, string | undefined>) => {
    const chosen = { ...config.defaultVariants, ...opts };
    const extra = Object.entries(config.variants).map(([key, map]) => {
      const value = chosen[key];
      return value ? map[value] ?? '' : '';
    });
    return cn(base, ...extra);
  };
}
