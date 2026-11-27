import {
  COMPANION_GONE_MS,
  COMPANION_REFRESH_MS,
  type CompanionCommand,
  type CompanionDesk,
  type CompanionEvent,
  type CompanionReport,
  type CompanionView,
} from '@slider/shared';

/** A tab of a signed-in person: its stream (once open) and what it last said of itself. */
interface Tab {
  send: ((event: CompanionEvent) => void) | null;
  /** Hands this tab what the phone asks of it (`command`). */
  ask: ((command: CompanionCommand) => void) | null;
  device: CompanionReport['device'];
  active: boolean;
  /** When it was last in front or changed its page. */
  at: number;
  /** When it last reported – in use or presenting count only while it keeps saying so. */
  toldAt: number;
  view: CompanionView | null;
}

/** In use or presenting, unsaid this long: no longer (a tab says it again each refresh). */
const LIVE_MS = COMPANION_REFRESH_MS * 1.5;

/** A report without its stream is forgotten after this long (the stream never came). */
const UNSTREAMED_MS = 2 * 60_000;

/**
 * The phone beside the computer („Begleiter“): every tab says what it is (phone or desk), whether
 * it is in front and – desks – what its page is about (`POST /calls/companion`); each tab of the
 * person hears the desk last worked at, on its call stream (`/calls/live`, event `companion`),
 * whenever that changes; what the phone asks of that computer (a slide show's step, a page to
 * open) goes to that one tab alone (`command`). In memory, like the calls: one API process; a
 * restart forgets it and the tabs say it again on their next change or reconnect.
 */
export class CompanionHub {
  private readonly people = new Map<string, Map<string, Tab>>();
  /** What each person's tabs last heard: the same is not sent twice. */
  private readonly told = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A tab's stream opened: it hears the desk now and on every change, and what it is asked. */
  connect(
    userId: string,
    peerId: string,
    send: (event: CompanionEvent) => void,
    ask: (command: CompanionCommand) => void,
  ): () => void {
    const tabs = this.tabsOf(userId);
    const tab = tabs.get(peerId) ?? {
      send: null,
      ask: null,
      device: 'desk',
      active: false,
      at: this.now(),
      toldAt: this.now(),
      view: null,
    };
    tab.send = send;
    tab.ask = ask;
    tabs.set(peerId, tab);
    this.deliver(tab, { desk: this.deskOf(userId) });
    return () => {
      if (tabs.get(peerId) !== tab) return;
      tabs.delete(peerId);
      if (tabs.size === 0) this.people.delete(userId);
      this.changed(userId);
    };
  }

  /** A tab says what it is and shows. */
  report(userId: string, report: CompanionReport) {
    const tabs = this.tabsOf(userId);
    const before = tabs.get(report.peerId);
    const view = report.device === 'desk' ? report.view : null;
    const moved =
      !before ||
      report.active !== before.active ||
      JSON.stringify(view) !== JSON.stringify(before.view);
    tabs.set(report.peerId, {
      send: before?.send ?? null,
      ask: before?.ask ?? null,
      device: report.device,
      active: report.active,
      at: moved || report.active ? this.now() : before.at,
      toldAt: this.now(),
      view,
    });
    this.changed(userId);
  }

  /** The desk the person last worked at: the newest desk tab with a page, not left too long. */
  deskOf(userId: string): CompanionDesk | null {
    const best = this.deskTab(userId);
    if (!best?.view) return null;
    const now = this.now();
    const { active, presenting } = this.live(best, now);
    return {
      view: best.view,
      // A slide show stepped on from the phone gets no input there: in use all the same.
      active: active || presenting,
      at: new Date(presenting ? now : best.at).toISOString(),
    };
  }

  /**
   * Hands the phone's command to the one computer tab it shows (`deskOf`) – of the same person,
   * never another tab. `false`: no computer of theirs is there.
   */
  command(userId: string, command: CompanionCommand): boolean {
    const tab = this.deskTab(userId);
    if (!tab?.ask) return false;
    try {
      tab.ask(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The newest desk tab with a page, a slide show running first (presenter view and audience's
   * window: the one in front), not left too long.
   */
  private deskTab(userId: string): Tab | null {
    const now = this.now();
    let best: Tab | null = null;
    for (const [peerId, tab] of this.tabsOf(userId)) {
      // A report whose stream never came (the tab went before it opened) – forgotten.
      if (!tab.send && now - tab.at > UNSTREAMED_MS) {
        this.people.get(userId)?.delete(peerId);
        continue;
      }
      if (tab.device !== 'desk' || !tab.view || !tab.send) continue;
      const rank = (each: Tab) => {
        const { active, presenting } = this.live(each, now);
        return (presenting ? 2 : 0) + (active ? 1 : 0);
      };
      const better =
        !best || rank(tab) > rank(best) || (rank(tab) === rank(best) && tab.at > best.at);
      if (better) best = tab;
    }
    if (!best?.view) return null;
    const { active, presenting } = this.live(best, now);
    const at = active || presenting ? now : best.at;
    return now - at > COMPANION_GONE_MS ? null : best;
  }

  /** In use, presenting – as the tab said, while it keeps saying it (`COMPANION_REFRESH_MS`). */
  private live(tab: Tab, now: number) {
    const fresh = now - tab.toldAt <= LIVE_MS;
    return { active: fresh && tab.active, presenting: fresh && !!tab.view?.show };
  }

  private tabsOf(userId: string): Map<string, Tab> {
    let tabs = this.people.get(userId);
    if (!tabs) {
      tabs = new Map();
      this.people.set(userId, tabs);
    }
    return tabs;
  }

  /** Every tab of the person hears the desk – once per change. */
  private changed(userId: string) {
    const desk = this.deskOf(userId);
    // `at` moves with every report of a tab in front: only what the phone shows counts.
    const key = JSON.stringify(desk && { view: desk.view, active: desk.active });
    if (this.told.get(userId) === key) return;
    if (desk || this.people.has(userId)) this.told.set(userId, key);
    else this.told.delete(userId);
    for (const tab of this.people.get(userId)?.values() ?? []) this.deliver(tab, { desk });
  }

  private deliver(tab: Tab, event: CompanionEvent) {
    try {
      tab.send?.(event);
    } catch {
      // A stream that is gone leaves by itself.
    }
  }
}
