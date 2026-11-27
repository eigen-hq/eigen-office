import {
  COMPANION_GONE_MS,
  type CompanionDesk,
  type CompanionEvent,
  type CompanionReport,
  type CompanionView,
} from '@slider/shared';

/** A tab of a signed-in person: its stream (once open) and what it last said of itself. */
interface Tab {
  send: ((event: CompanionEvent) => void) | null;
  device: CompanionReport['device'];
  active: boolean;
  /** When it was last in front or changed its page. */
  at: number;
  view: CompanionView | null;
}

/** A report without its stream is forgotten after this long (the stream never came). */
const UNSTREAMED_MS = 2 * 60_000;

/**
 * The phone beside the computer („Begleiter“): every tab says what it is (phone or desk), whether
 * it is in front and – desks – what its page is about (`POST /calls/companion`); each tab of the
 * person hears the desk last worked at, on its call stream (`/calls/live`, event `companion`),
 * whenever that changes. In memory, like the calls: a restart forgets it and the tabs say it
 * again on their next change or reconnect.
 */
export class CompanionHub {
  private readonly people = new Map<string, Map<string, Tab>>();
  /** What each person's tabs last heard: the same is not sent twice. */
  private readonly told = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A tab's stream opened: it hears the desk now and on every change. */
  connect(userId: string, peerId: string, send: (event: CompanionEvent) => void): () => void {
    const tabs = this.tabsOf(userId);
    const tab = tabs.get(peerId) ?? {
      send: null,
      device: 'desk',
      active: false,
      at: this.now(),
      view: null,
    };
    tab.send = send;
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
      device: report.device,
      active: report.active,
      at: moved || report.active ? this.now() : before.at,
      view,
    });
    this.changed(userId);
  }

  /** The desk the person last worked at: the newest desk tab with a page, not left too long. */
  deskOf(userId: string): CompanionDesk | null {
    const now = this.now();
    let best: Tab | null = null;
    for (const [peerId, tab] of this.tabsOf(userId)) {
      // A report whose stream never came (the tab went before it opened) – forgotten.
      if (!tab.send && now - tab.at > UNSTREAMED_MS) {
        this.people.get(userId)?.delete(peerId);
        continue;
      }
      if (tab.device !== 'desk' || !tab.view || !tab.send) continue;
      const better =
        !best || (tab.active && !best.active) || (tab.active === best.active && tab.at > best.at);
      if (better) best = tab;
    }
    if (!best?.view) return null;
    const at = best.active ? now : best.at;
    if (now - at > COMPANION_GONE_MS) return null;
    return { view: best.view, active: best.active, at: new Date(best.at).toISOString() };
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
