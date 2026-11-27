import { DEFAULT_COMPANION_MODE } from '@slider/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMe } from '@/lib/api';
import { useCompanionHeard } from '@/lib/companion';
import { routes } from '@/lib/routes';
import { IconButton } from '@/ui';
import { offered } from '../lib/auto';
import { useDevice } from '../lib/device';

/** The minute ticking on: a computer left an hour ago is offered no more. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Beside the date in the phone's header, while one's computer is open: a screen with a phone
 * beside it, a dot when the computer is in use right now – one tap and the phone shows what goes
 * with the computer's page. No pop-up, nothing asked: it stands there, or not.
 */
export function CompanionButton() {
  // A phone or a tablet: offered (a tablet never turns into it by itself).
  const phone = useDevice() !== 'desk';
  const mode = useMe().data?.user?.companion ?? DEFAULT_COMPANION_MODE;
  const { desk } = useCompanionHeard();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useMinute();
  const shown = location.pathname === routes.companion();
  if (!desk || !offered({ mode, desk, now, phone, shown })) return null;
  const label = `Begleiter öffnen | am Computer: ${desk.view.title || 'Eigen Office'}`;
  return (
    <span className="relative flex shrink-0">
      <IconButton
        icon="devices"
        label={label}
        variant="ghost"
        onClick={() =>
          void navigate(routes.companion(), {
            state: { from: `${location.pathname}${location.search}` },
          })
        }
      />
      {desk.active && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-success"
        />
      )}
    </span>
  );
}
