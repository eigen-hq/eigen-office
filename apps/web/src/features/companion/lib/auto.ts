import {
  COMPANION_GONE_MS,
  COMPANION_RECENT_MS,
  type CompanionDesk,
  type CompanionMode,
} from '@slider/shared';

/** The computer is there for the phone: open, and not left longer than an hour. */
export const deskThere = (desk: CompanionDesk | null, now: number): desk is CompanionDesk =>
  !!desk && (desk.active || now - Date.parse(desk.at) < COMPANION_GONE_MS);

/** The computer is in use: its tab in front, or in front only a moment ago. */
export const deskInUse = (desk: CompanionDesk | null, now: number): desk is CompanionDesk =>
  !!desk && (desk.active || now - Date.parse(desk.at) < COMPANION_RECENT_MS);

/** A phone touched this recently is being used: the companion does not take it over. */
export const BUSY_MS = 20_000;

export interface AutoState {
  mode: CompanionMode;
  desk: CompanionDesk | null;
  now: number;
  /** This tab is a phone. */
  phone: boolean;
  /** The phone shows the companion already. */
  shown: boolean;
  /** One left the companion while this computer stayed in use: it is offered, not opened. */
  dismissed: boolean;
  /** The phone's tab is seen (not in the background, screen on). */
  visible: boolean;
  /** When the phone was last touched or typed on; just woken counts as untouched. */
  touchedAt: number;
  /** A field on the phone has the focus. */
  typing: boolean;
  /** The phone is in a call. */
  inCall: boolean;
  /** The page has nothing to do with work (sign-in, setup, a public page). */
  outside: boolean;
}

/**
 * „Automatisch“: the phone turns into the companion by itself when the computer is in use and
 * the phone lies there – not while one types or calls on it, not right after one touched it, not
 * again after one left it (until the computer was left and is used anew).
 */
export function opensByItself(state: AutoState): boolean {
  return (
    state.mode === 'auto' &&
    state.phone &&
    !state.shown &&
    !state.dismissed &&
    !state.outside &&
    state.visible &&
    !state.typing &&
    !state.inCall &&
    state.now - state.touchedAt >= BUSY_MS &&
    deskInUse(state.desk, state.now)
  );
}

/** „Fragen“ (or left in „Automatisch“): the sign beside the date offers it while the computer is there. */
export function offered(state: Pick<AutoState, 'mode' | 'desk' | 'now' | 'phone' | 'shown'>) {
  return state.mode !== 'never' && state.phone && !state.shown && deskThere(state.desk, state.now);
}
