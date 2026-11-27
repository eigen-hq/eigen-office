import type { CompanionDesk } from '@slider/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  companionHeard,
  companionStreamLost,
  companionStreamOpened,
  hearCompanion,
} from '@/lib/companion';
import { deskLeft, offered, opensByItself, type AutoState } from './auto';
import { deskShows } from './command';
import { viewOf } from './view';

const NOW = Date.parse('2026-11-27T10:00:00Z');

describe('companion', () => {
  it('reads what the computer has open, and opens on the phone only when that is wanted', () => {
    const at = (path: string) => {
      const [pathname = '', search = ''] = path.split('?');
      return viewOf(pathname, search ? `?${search}` : '', 'Titel', 'Zeilen', 'w0');
    };
    expect(at('/w/w1/dateien/mail/t1')).toMatchObject({
      kind: 'mail',
      id: 't1',
      workspaceId: 'w1',
    });
    expect(at('/w/w1/nachrichten/mail/t2').kind).toBe('mail');
    // The mailboxes' page is no mail.
    expect(at('/w/w1/dateien/mail/postfaecher').kind).toBe('page');
    expect(at('/w/w1/nachrichten/kanal/c1')).toMatchObject({ kind: 'chat', id: 'c1' });
    expect(at('/w/w1/dateien/bereich/a1/chat/c2')).toMatchObject({ kind: 'chat', id: 'c2' });
    expect(at('/w/w1/dateien/kalender?termin=e1&tag=2026-12-01')).toMatchObject({
      kind: 'calendar',
      id: 'e1',
      sub: '2026-12-01',
    });
    // A new event and a day's agenda are no event; the agenda's day is the day.
    expect(at('/w/w1/dateien/kalender?termin=neu').id).toBeNull();
    expect(at('/w/w1/dateien/kalender?termin=tag&am=2026-12-03')).toMatchObject({
      id: null,
      sub: '2026-12-03',
    });
    expect(at('/w/w1/dateien/ordner/f1?datei=n1')).toMatchObject({ kind: 'file', id: 'n1' });
    // A page and a diagram open are their files; a to-do's panel lies over everything.
    expect(at('/w/w1/dateien/seite/p1')).toMatchObject({ kind: 'file', id: 'p1' });
    expect(at('/diagramm/g1')).toMatchObject({ kind: 'file', id: 'g1', workspaceId: 'w0' });
    expect(at('/w/w1/dateien/aufgaben?aufgabe=t9&datei=n1')).toMatchObject({
      kind: 'todo',
      id: 't9',
    });
    expect(at('/w/w1/dateien/aufgaben').kind).toBe('page');
    // An area's chat without a channel: the area, its own channel found on the phone.
    expect(at('/w/w1/dateien/bereich/a1/chat')).toMatchObject({
      kind: 'chat',
      id: null,
      sub: 'a1',
    });
    // Outside a workspace's address: the workspace one is in.
    expect(at('/d/d1?slide=s3')).toMatchObject({
      kind: 'deck',
      id: 'd1',
      sub: 's3',
      workspaceId: 'w0',
    });
    expect(at('/t/doc1').kind).toBe('document');
    expect(at('/r/pdf1').kind).toBe('pdf');
    expect(at('/w/w1/dateien')).toMatchObject({ kind: 'page', title: 'Titel', here: 'Zeilen' });

    const desk = (active: boolean, ago: number): CompanionDesk => ({
      view: at('/t/doc1'),
      active,
      at: new Date(NOW - ago).toISOString(),
    });
    const lying: AutoState = {
      mode: 'auto',
      desk: desk(true, 0),
      now: NOW,
      phone: true,
      shown: false,
      dismissed: false,
      visible: true,
      touchedAt: 0,
      typing: false,
      inCall: false,
      outside: false,
    };
    expect(opensByItself(lying)).toBe(true);
    for (const not of [
      { mode: 'ask' as const },
      { mode: 'never' as const },
      { phone: false },
      { shown: true },
      { dismissed: true },
      { visible: false },
      { typing: true },
      { inCall: true },
      { outside: true },
      // Touched a moment ago: in use, not taken over.
      { touchedAt: NOW - 5_000 },
      // The computer left five minutes ago: not in use.
      { desk: desk(false, 5 * 60_000) },
      { desk: null },
    ])
      expect(opensByItself({ ...lying, ...not }), JSON.stringify(not)).toBe(false);
    expect(opensByItself({ ...lying, touchedAt: NOW - 25_000 })).toBe(true);

    // „Fragen“: offered while the computer is there (an hour), never with „Nie“.
    expect(offered({ ...lying, mode: 'ask', desk: desk(false, 30 * 60_000) })).toBe(true);
    expect(offered({ ...lying, mode: 'ask', desk: desk(false, 61 * 60_000) })).toBe(false);
    expect(offered({ ...lying, mode: 'never' })).toBe(false);
    expect(offered({ ...lying, shown: true })).toBe(false);

    // Left with ✕: opens again only once the computer was not in use for a while.
    expect(deskLeft(NOW - 60_000, NOW)).toBe(false);
    expect(deskLeft(NOW - 2 * 60_000, NOW)).toBe(true);

    // „Am Computer öffnen“ counts as done once the computer shows that page (more of its own in
    // the search is fine), not on the server's word alone.
    const there = (path: string) => ({ ...desk(true, 0), view: { ...desk(true, 0).view, path } });
    const todo = '/w/w1/dateien/aufgaben?aufgabe=t1';
    expect(deskShows(there('/w/w1/dateien/aufgaben?aufgabe=t1&x=1'), todo)).toBe(true);
    expect(deskShows(there('/w/w1/dateien/aufgaben?aufgabe=t2'), todo)).toBe(false);
    expect(deskShows(there('/w/w1/dateien/kalender?aufgabe=t1'), todo)).toBe(false);
    expect(deskShows(null, todo)).toBe(false);

    // The stream broken: a blip keeps what was heard, a lasting break forgets the computer.
    vi.useFakeTimers();
    hearCompanion({ desk: desk(true, 0) });
    companionStreamLost();
    vi.advanceTimersByTime(10_000);
    companionStreamOpened();
    vi.advanceTimersByTime(10_000);
    expect(companionHeard().desk).not.toBeNull();
    // Each failed retry says it again: counted from the break all the same.
    companionStreamLost();
    vi.advanceTimersByTime(10_000);
    companionStreamLost();
    vi.advanceTimersByTime(5_000);
    expect(companionHeard().desk).toBeNull();
    vi.useRealTimers();
  });
});
