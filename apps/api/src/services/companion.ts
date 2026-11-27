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
  /** Hands this tab what the phone asks of it (`command`); `false`: its stream is gone. */
  ask: ((command: CompanionCommand) => boolean) | null;
  device: CompanionReport['device'];
  active: boolean;
  /** A slide show or a call runs there: no page opened from the phone. */
  busy: boolean;
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

/** Tabs kept per person: a new one beyond takes the place of the oldest without its stream. */
const MAX_TABS = 20;

/** What became of a command from the phone. */
export type CompanionAsked = 'sent' | 'none' | 'busy';

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
    ask: (command: CompanionCommand) => boolean,
  ): () => void {
    const tabs = this.tabsOf(userId);
    const tab = tabs.get(peerId) ?? {
      send: null,
      ask: null,
      device: 'desk',
      active: false,
      busy: false,
      at: this.now(),
      toldAt: this.now(),
      view: null,
    };
    tab.send = send;
    tab.ask = ask;
    tabs.set(peerId, tab);
    this.deliver(tab, { desk: this.deskOf(userId) });
    return () => {
      // Only while this stream is still the tab's: one that dropped and came back (same tab, its
      // entry kept) leaves late, after the new stream took over.
      const current = this.people.get(userId);
      if (current?.get(peerId) !== tab || tab.send !== send) return;
      current.delete(peerId);
      if (current.size === 0) this.people.delete(userId);
      this.changed(userId);
    };
  }

  /** A tab says what it is and shows. */
  report(userId: string, report: CompanionReport) {
    const tabs = this.tabsOf(userId);
    const before = tabs.get(report.peerId);
    if (!before && tabs.size >= MAX_TABS && !this.makeRoom(tabs)) return;
    const view = report.device === 'desk' ? report.view : null;
    const moved =
      !before ||
      report.active !== before.active ||
      JSON.stringify(view) !== JSON.stringify(before.view);
    const now = this.now();
    // Changed in place: the stream's cleanup (`connect`) knows its tab by this object.
    const tab = before ?? { send: null, ask: null, at: now };
    Object.assign(tab, {
      device: report.device,
      active: report.active,
      busy: !!report.busy,
      at: moved || report.active ? now : tab.at,
      toldAt: now,
      view,
    });
    tabs.set(report.peerId, tab as Tab);
    this.changed(userId);
  }

  /**
   * Said again as time passes (each stream's heartbeat): in use or presenting runs out without a
   * report (`live`) – the phone hears it then, not on the next change.
   */
  refresh(userId: string) {
    if (this.people.has(userId)) this.changed(userId);
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
   * never another tab. `none`: no computer of theirs is there; `busy`: a page is not opened over
   * the slide show or call running there.
   */
  command(userId: string, command: CompanionCommand): CompanionAsked {
    const tab = this.deskTab(userId);
    if (!tab?.ask) return 'none';
    if (command.type === 'open' && tab.busy) return 'busy';
    try {
      return tab.ask(command) ? 'sent' : 'none';
    } catch {
      return 'none';
    }
  }

  /** The oldest report without its stream goes; `false`: every tab has its stream. */
  private makeRoom(tabs: Map<string, Tab>): boolean {
    let oldest: [string, Tab] | null = null;
    for (const entry of tabs) {
      if (!entry[1].send && (!oldest || entry[1].toldAt < oldest[1].toldAt)) oldest = entry;
    }
    if (oldest) tabs.delete(oldest[0]);
    return !!oldest;
  }

  /**
   * The newest desk tab with a page, a slide show running first (presenter view and audience's
   * window: the one in front), not left too long.
   */
  private deskTab(userId: string): Tab | null {
    const now = this.now();
    let best: Tab | null = null;
    // Read, not made: a person without tabs is not kept in memory for asking.
    const tabs = this.people.get(userId);
    for (const [peerId, tab] of tabs ?? []) {
      // A report whose stream never came (the tab went before it opened) – forgotten.
      if (!tab.send && now - tab.toldAt > UNSTREAMED_MS) {
        tabs?.delete(peerId);
        if (tabs?.size === 0) this.people.delete(userId);
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
