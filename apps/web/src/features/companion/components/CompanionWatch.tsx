import { COMPANION_RECENT_MS, DEFAULT_COMPANION_MODE } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { useCallsOrNull } from '@/features/calls';
import { useMe } from '@/lib/api';
import { useCompanionHeard } from '@/lib/companion';
import { isTextTarget } from '@/lib/dom';
import { routes } from '@/lib/routes';
import { deskInUse, opensByItself } from '../lib/auto';
import { useDevice } from '../lib/device';
import { useReportView } from '../lib/report';

/** How often the phone looks again whether to open the companion (a touch's pause ran out). */
const LOOK_MS = 5_000;

/** Pages that have nothing to do with work: the companion never takes them over. */
const OUTSIDE = [
  '/login',
  '/registrieren',
  '/konto-bestaetigen/:token',
  '/anmelden/:token',
  '/einrichtung',
  '/join/:token',
  '/datenschutz',
  '/impressum',
  '/datenanfrage',
  '/daten/:token',
  '/s/:token',
];

/**
 * One left the companion while the computer stayed in use: offered from then on, not opened –
 * until the computer was left a while and is used anew.
 */
let dismissed = false;
/** Since when no computer was heard at all (its tab reloading, a reconnect): `null` while one is. */
let goneSince: number | null = null;
export const dismissCompanion = () => {
  dismissed = true;
};

/**
 * Around every page (inside the router): every tab tells the server what it is and – a computer –
 * what its page is about (`useReportView`); a phone set to „Automatisch“ turns into the companion
 * by itself when the computer is in use and the phone lies there untouched.
 */
export function CompanionWatch() {
  const kind = useDevice();
  const mode = useMe().data?.user?.companion ?? DEFAULT_COMPANION_MODE;
  // A tablet shows like a phone (never the computer one works at); only a phone opens by itself.
  // „Nie“: no tab says what it shows.
  useReportView(kind !== 'desk', mode !== 'never');
  const phone = kind === 'phone';
  const { desk } = useCompanionHeard();
  const navigate = useNavigate();
  const location = useLocation();
  const calls = useCallsOrNull();
  const inCall = !!calls?.snap.active;
  const shown = location.pathname === routes.companion();
  const outside = OUTSIDE.some((pattern) => !!matchPath(pattern, location.pathname));
  const touchedAt = useRef(0);
  const [tick, setTick] = useState(0);

  // Touched or typed on: being used. Woken (the tab seen again): lying there – untouched.
  useEffect(() => {
    if (!phone) return;
    const touched = () => {
      touchedAt.current = Date.now();
    };
    const woken = () => {
      if (document.visibilityState === 'visible') {
        touchedAt.current = 0;
        setTick((now) => now + 1);
      }
    };
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('keydown', touched, true);
    document.addEventListener('visibilitychange', woken);
    const timer = window.setInterval(() => setTick((now) => now + 1), LOOK_MS);
    return () => {
      window.removeEventListener('pointerdown', touched, true);
      window.removeEventListener('keydown', touched, true);
      document.removeEventListener('visibilitychange', woken);
      window.clearInterval(timer);
    };
  }, [phone]);

  // Left the companion, whichever way (✕, „Hier öffnen“, a link in it): offered, not reopened.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown) dismissed = true;
    wasShown.current = shown;
  }, [shown]);

  useEffect(() => {
    const now = Date.now();
    // The computer was left: next time it is used, the companion opens again. None heard (its tab
    // reloading, a reconnect) counts only once that lasts as long.
    if (desk) goneSince = null;
    else goneSince ??= now;
    const left = desk
      ? !deskInUse(desk, now)
      : goneSince !== null && now - goneSince >= COMPANION_RECENT_MS;
    if (left) dismissed = false;
    const open = opensByItself({
      mode,
      desk,
      now,
      phone,
      shown,
      dismissed,
      outside,
      visible: document.visibilityState === 'visible',
      touchedAt: touchedAt.current,
      typing: isTextTarget(document.activeElement),
      inCall,
    });
    if (open)
      void navigate(routes.companion(), {
        state: { from: `${location.pathname}${location.search}` },
      });
  }, [desk, mode, phone, shown, outside, inCall, tick, navigate, location]);

  return null;
}
