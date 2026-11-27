import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { expect, test, uploadSampleDeck } from '../support';

/** A second device of the same person: its own browser, signed in as the desk is. */
async function device(browser: Browser, desk: Page, options: BrowserContextOptions) {
  const context = await browser.newContext({
    storageState: await desk.context().storageState(),
    locale: 'de-DE',
    ...options,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { context, page, errors };
}

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test('the phone beside the computer follows it, holds still while touched, opens there, steps its slide show and rests; a tablet is only offered it', async ({
  page: desk,
  browser,
}) => {
  test.setTimeout(180_000);
  const [workspace] = (await (await desk.request.get('/api/workspaces')).json()) as {
    id: string;
  }[];
  const ws = workspace!.id;
  // Worked at: a move and a key, as a person at the desk.
  const use = async () => {
    await desk.mouse.move(100 + Math.random() * 200, 300);
    await desk.keyboard.press('Shift');
  };
  await desk.goto(`/w/${ws}/dateien`);
  await use();

  // „Automatisch“: the phone turns into the companion by itself. Its clock is the test's – the
  // waits for „left alone“ pass at once.
  const phone = await device(browser, desk, PHONE);
  await phone.context.clock.install();
  await phone.page.goto(`/w/${ws}/dateien`);
  await expect(phone.page).toHaveURL(/\/begleiter/, { timeout: 40_000 });

  // A to-do open at the desk: its card; tapped, its panel on the phone.
  const title = `Angebot nachfassen ${Date.now()}`;
  const todo = (await (
    await desk.request.post(`/api/workspaces/${ws}/todos`, {
      data: { title, description: 'Preis klären.' },
    })
  ).json()) as { id: string };
  await desk.goto(`/w/${ws}/dateien/aufgaben?aufgabe=${todo.id}`);
  await use();
  const card = phone.page.getByRole('button', { name: new RegExp(title) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(phone.page).toHaveURL(/aufgabe=/);

  // Touched: a new page at the desk waits in a bar („Zeigen“), the to-do stays in hand – and
  // „Am Computer öffnen“ opens it there.
  await desk.goto(`/w/${ws}/dateien/kalender`);
  await use();
  const waiting = phone.page.getByRole('button', { name: /^Am Computer: Kalender.*Zeigen$/ });
  await expect(waiting).toBeVisible({ timeout: 20_000 });
  await phone.page.getByRole('button', { name: 'Am Computer öffnen' }).click();
  await expect(desk).toHaveURL(new RegExp(`aufgabe=${todo.id}`), { timeout: 10_000 });
  await phone.page.keyboard.press('Escape');
  await phone.page.clock.fastForward(25_000);
  await expect(waiting).toBeHidden();

  // A tablet is offered the companion in its header, never turned into it, never the desk.
  const tablet = await device(browser, desk, {
    viewport: { width: 1024, height: 1366 },
    isMobile: true,
    hasTouch: true,
  });
  await tablet.page.goto(`/w/${ws}/dateien`);
  await expect(tablet.page.getByRole('button', { name: /^Begleiter öffnen/ })).toBeVisible({
    timeout: 20_000,
  });
  await tablet.page.waitForTimeout(6_000);
  await expect(tablet.page).not.toHaveURL(/\/begleiter/);
  await expect(phone.page.getByText('Aufgabe', { exact: true })).toBeVisible();
  expect(tablet.errors).toEqual([]);
  await tablet.context.close();

  // A slide show at the desk, stepped on from the phone: the steps reach the desk, black and back.
  const deck = await uploadSampleDeck(desk);
  await desk.goto(`/d/${deck.id}`);
  await use();
  await expect(async () => {
    await desk.getByRole('button', { name: 'Präsentieren' }).click({ button: 'right' });
    await desk.getByRole('menuitem', { name: 'Referentenansicht' }).click({ timeout: 2_000 });
  }).toPass();
  const presenter = desk.getByRole('dialog', { name: /^Referentenansicht/ });
  const at = (n: number) => presenter.getByText(`Folie ${n} von 5`, { exact: true });
  await expect(at(1)).toBeVisible();
  const next = phone.page.getByRole('button', { name: 'Weiter' });
  await expect(next).toBeVisible({ timeout: 20_000 });
  await expect(phone.page.getByText('Folie 1 / 5')).toBeVisible();
  await next.click();
  await expect(at(2)).toBeVisible({ timeout: 5_000 });
  await expect(phone.page.getByText('Folie 2 / 5')).toBeVisible();
  await phone.page.getByRole('button', { name: 'Zurück' }).click();
  await expect(at(1)).toBeVisible({ timeout: 5_000 });
  const black = phone.page.getByRole('button', { name: 'Schwarz' });
  await black.click();
  await expect(black).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await black.click();
  await expect(black).not.toHaveAttribute('aria-pressed');
  // Not while presenting: left alone, the companion does not rest.
  await phone.page.clock.fastForward('02:30');
  await expect(phone.page.locator('[data-companion-ambient]')).toBeHidden();
  await desk.keyboard.press('Escape');
  await expect(presenter).toBeHidden();
  await expect(next).toBeHidden({ timeout: 20_000 });

  // Left alone: it rests – dark, the time, what the computer shows in a word; a tap wakes it.
  await phone.page.clock.fastForward('02:30');
  const ambient = phone.page.locator('[data-companion-ambient]');
  await expect(ambient).toBeVisible();
  await expect(ambient).toContainText('Am Computer: Präsentation');
  await ambient.tap();
  await expect(ambient).toBeHidden();
  expect(phone.errors).toEqual([]);
  await phone.context.close();
});
