import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/session.js';

// The Companion panel is the Learner's session, so it must not float over the
// page: on desktop the open panel docks as a right-hand rail below the sticky
// nav — the nav stays visible and the content shifts clear, so the Learner can
// keep the session in view while learning. Narrow screens keep the overlay
// drawer because there is no room to dock.

test('on desktop the open panel docks below the nav, beside the content', async ({ page }) => {
  await seedSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library.html?agent=off');

  await page.getByRole('button', { name: 'Open GapMap companion' }).click();

  const layout = await page.evaluate(() => {
    const nav = document.querySelector('.nav').getBoundingClientRect();
    const panel = document.querySelector('.gm-agent-panel').getBoundingClientRect();
    const container = document.querySelector('.container').getBoundingClientRect();
    return {
      navBottom: nav.bottom,
      panelTop: panel.top,
      panelBottom: panel.bottom,
      panelLeft: panel.left,
      containerRight: container.right,
      docked: document.body.classList.contains('gm-panel-open'),
    };
  });

  expect(layout.docked).toBe(true);
  // The rail starts exactly where the nav ends: the nav stays visible above it.
  expect(layout.navBottom).toBeGreaterThan(0);
  expect(layout.panelTop).toBe(layout.navBottom);
  expect(layout.panelBottom).toBe(900);
  // The chat lives beside the content, not over it.
  expect(layout.containerRight).toBeLessThanOrEqual(layout.panelLeft);
});

test('closing the docked panel releases the page', async ({ page }) => {
  await seedSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library.html?agent=off');

  await page.getByRole('button', { name: 'Open GapMap companion' }).click();
  await page.getByRole('button', { name: 'Close GapMap companion' }).click();

  const layout = await page.evaluate(() => ({
    docked: document.body.classList.contains('gm-panel-open'),
    containerRight: document.querySelector('.container').getBoundingClientRect().right,
  }));
  expect(layout.docked).toBe(false);
});

test('on wide screens the dock shifts nothing when the rail would not cover the content', async ({
  page,
}) => {
  await seedSession(page);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/profile.html?agent=off');

  const before = await page.evaluate(() =>
    document.querySelector('.container').getBoundingClientRect().left,
  );
  await page.getByRole('button', { name: 'Open GapMap companion' }).click();

  const after = await page.evaluate(() => ({
    left: document.querySelector('.container').getBoundingClientRect().left,
    inlineMargin: document.querySelector('.container').style.marginRight,
  }));
  // The centred column never reaches the rail on a wide screen: no shift.
  expect(after.inlineMargin).toBe('');
  expect(after.left).toBe(before);
});

test('on narrow screens the panel keeps the overlay drawer', async ({ page }) => {
  await seedSession(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/library.html?agent=off');

  await page.getByRole('button', { name: 'Open GapMap companion' }).click();

  const layout = await page.evaluate(() => ({
    panelTop: document.querySelector('.gm-agent-panel').getBoundingClientRect().top,
    scrimShown: getComputedStyle(document.querySelector('.gm-agent-scrim')).display !== 'none',
  }));
  // Overlay: it covers from the very top (scrim visible, no dock).
  expect(layout.panelTop).toBe(0);
  expect(layout.scrimShown).toBe(true);
});