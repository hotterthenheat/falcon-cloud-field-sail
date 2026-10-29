/* What the shell shows while a page's code travels: the page's own shape by path, from small skeleton files that import nothing heavy;
   pages without one fall back to the page skeleton. */

import { PageSkeleton } from './Skeleton';
import { PinpointRouteSkeleton } from '../../pages/pinpoint/pinpointSkeletons';
import { TraceRouteSkeleton } from '../../pages/trace/traceSkeletons';
import { WeigherPageSkeleton } from '../../pages/weigherSkeleton';
import { CompassHeadSkeleton, CompassRouteSkeleton } from '../../pages/compassSkeleton';
import { PulsePageSkeleton } from '../../pages/workspace/pulseSkeletons';
import { RecordRouteSkeleton } from '../../pages/record/recordSkeletons';
import { PracticeRouteSkeleton } from '../../pages/practice/practiceSkeletons';
import { SettingsPageSkeleton } from '../../pages/settings/settingsSkeleton';
import { RoomRouteSkeleton } from '../../pages/community/roomSkeleton';
import { StartRouteSkeleton } from '../../pages/start/startSkeleton';

const RouteSkeleton = ({ pathname }: { pathname: string }) => {
  if (pathname === '/start') return <StartRouteSkeleton />;
  if (pathname.startsWith('/community')) return <RoomRouteSkeleton />;
  if (pathname.startsWith('/pinpoint')) return <PinpointRouteSkeleton pathname={pathname} />;
  if (pathname.startsWith('/settings')) return <SettingsPageSkeleton section={pathname.split('/')[2]} />;
  if (pathname.startsWith('/dossier')) return <RecordRouteSkeleton pathname={pathname} />;
  if (pathname.startsWith('/practice')) return <PracticeRouteSkeleton pathname={pathname} />;
  if (pathname.startsWith('/trace')) return <TraceRouteSkeleton pathname={pathname} />;
  if (pathname.startsWith('/weigher')) return <WeigherPageSkeleton />;
  if (pathname.startsWith('/compass'))
    return (
      <>
        <CompassHeadSkeleton />
        <CompassRouteSkeleton pathname={pathname} />
      </>
    );
  if (pathname.startsWith('/pulse')) return <PulsePageSkeleton />;
  return <PageSkeleton />;
};

export default RouteSkeleton;
