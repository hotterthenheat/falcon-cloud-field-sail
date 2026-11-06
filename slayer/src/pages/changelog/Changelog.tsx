/* CHANGELOG: what changed for the people who use the terminal, newest first, by day (data/changelog.ts). A filter by
   kind; each entry links to where it can be seen. */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ScrollText } from 'lucide-react';
import SurfaceHead, { HeadFact } from '../../components/help/SurfaceHead';
import { Badge } from '../../components/shadcn/badge';
import { ToggleGroup, ToggleGroupItem } from '../../components/shadcn/toggle-group';
import { CHANGELOG, changelogDays, LATEST_CHANGE, type ChangeKind } from '../../data/changelog';
import { APP_VERSION } from '../../data/appVersion';

const KIND_WORDS: Record<ChangeKind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
/* the badge inks keep their one meaning each (shadcn/badge.tsx): silver for what is new, the plain tag for the rest —
   never the market's green or red for a kind of change */
const KIND_BADGE: Record<ChangeKind, 'silver' | 'neutral' | 'ghost'> = { new: 'silver', improved: 'neutral', fixed: 'neutral' };
type Filter = 'all' | ChangeKind;

/** "Friday, November 6, 2026" for a New York date */
const dayWords = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

const Changelog = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const days = useMemo(() => changelogDays(filter === 'all' ? CHANGELOG : CHANGELOG.filter(e => e.kind === filter)), [filter]);
  return (
    <>
      <SurfaceHead
        icon={ScrollText}
        title="Changelog"
        line="What changed in the terminal, newest first"
        testId="changelog"
        facts={
          <>
            <HeadFact label="Version">v{APP_VERSION}</HeadFact>
            <HeadFact label="Latest" testId="latest">
              {LATEST_CHANGE ? dayWords(LATEST_CHANGE).replace(/^\w+, /, '') : '—'}
            </HeadFact>
            <HeadFact label="Entries">{CHANGELOG.length}</HeadFact>
          </>
        }
      />
      <div className="w-full max-w-[860px] flex flex-col gap-4" data-changelog>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={v => v && setFilter(v as Filter)}
          aria-label="Show"
          className="self-start flex flex-wrap gap-1"
        >
          {(['all', 'new', 'improved', 'fixed'] as Filter[]).map(f => (
            <ToggleGroupItem key={f} value={f} className="h-7 max-sm:h-10 px-2.5" data-changelog-filter={f}>
              {f === 'all' ? 'Everything' : KIND_WORDS[f]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {days.length === 0 && <p className="text-t12 text-textMuted">Nothing of that kind yet.</p>}
        {days.map(day => (
          <section key={day.date} aria-labelledby={`day-${day.date}`} className="flex flex-col gap-2" data-changelog-day={day.date}>
            <h2 id={`day-${day.date}`} className="font-mono text-t10 uppercase tracking-widest text-textMuted">
              <time dateTime={day.date}>{dayWords(day.date)}</time>
            </h2>
            <ol className="border border-borderSubtle rounded-md bg-panel overflow-clip">
              {day.entries.map((e, i) => (
                <li key={e.id} className={`px-5 py-3.5 flex flex-col gap-1.5 ${i ? 'border-t border-borderSubtle/60' : ''}`} data-changelog-entry={e.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={KIND_BADGE[e.kind]} caps size="sm">
                      {KIND_WORDS[e.kind]}
                    </Badge>
                    <span className="font-mono text-t10 text-textMuted">{e.area}</span>
                  </div>
                  <h3 className="text-t13 font-semibold leading-snug text-textPrimary">{e.title}</h3>
                  <p className="text-t12 leading-relaxed text-textSecondary max-w-[70ch]">{e.body}</p>
                  {e.to && (
                    <Link to={e.to} className="self-start inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary underline decoration-borderMuted underline-offset-4">
                      See it <ArrowUpRight className="w-3 h-3" aria-hidden />
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
};

export default Changelog;
