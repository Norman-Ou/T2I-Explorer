import { expect, test } from '@playwright/test';
import { openPage, reloadPage } from './navigation.js';

const single = '/?dataset=sft-e6.0-r30&cols=refseg:sior-t:baseline:a';
const original = '/api/media/sft-e6.0-r30/refseg/sior-t/baseline/fixture-A/original_image';
const thumbnail = `${original}?variant=thumbnail`;
const recordsRoute = '**/api/collections/sft-e6.0-r30/tasks/refseg/datasets/sior-t/exps/baseline/records';

test('a stalled thumbnail leaves healthy panels usable, while detail images load independently', async ({ page }) => {
    const originals: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/media/') && !request.url().includes('variant=thumbnail')) originals.push(request.url()); });
    await page.route(`**${thumbnail}`, () => {});
    await openPage(page, single);
    const first = page.locator('.record-cell').first();
    await expect(first.locator('.media-panel[data-media-state="ready"]')).toHaveCount(4);
    await expect(first.locator('.media-panel').first()).toHaveAttribute('data-media-state', 'loading');
    expect(originals).toHaveLength(0);
    await first.getByRole('button', { name: 'Open all 5 panels for fixture-A: Original' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.media-panel[data-media-state="ready"]')).toHaveCount(5);
    await expect.poll(() => dialog.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(originals).toHaveLength(5);
});

test('temporary failures retry automatically and permanent failures have an independent retry button', async ({ page }) => {
    let attempts = 0;
    await page.route(`**${thumbnail}`, route => ++attempts === 1 ? route.fulfill({ status: 503, body: 'Temporary failure' }) : route.continue());
    await openPage(page, single);
    const panel = page.locator('.record-cell').first().locator('.media-panel').first();
    await expect(panel).toHaveAttribute('data-media-state', 'ready');
    expect(attempts).toBe(2);
    await page.unroute(`**${thumbnail}`);
    attempts = 0;
    await page.route(`**${thumbnail}`, route => ++attempts === 1 ? route.fulfill({ status: 404, body: 'Missing' }) : route.continue());
    await reloadPage(page);
    await panel.getByRole('button', { name: 'Retry Original' }).click();
    await expect(panel).toHaveAttribute('data-media-state', 'ready');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(attempts).toBe(2);
    await expect(page.locator('button button')).toHaveCount(0);
});

test('only nearby rows request thumbnails, and scrolling starts the next group', async ({ page }) => {
    const requested = new Set<string>();
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.searchParams.has('row')) requested.add(url.searchParams.get('row')!);
    });
    await page.route(recordsRoute, async route => {
        const data = await (await route.fetch()).json();
        data.records = Array.from({ length: 30 }, (_, i) => ({
            ...data.records[0], sample_id: `row-${i}`, index: i + 1,
            panels: data.records[0].panels.map((panel: { thumbnail_url: string }) => ({ ...panel, thumbnail_url: `${panel.thumbnail_url}&row=${i}` }))
        }));
        await route.fulfill({ json: data });
    });
    await openPage(page, `${single}&pageSize=50`);
    await expect(page.locator('.record-cell').first().locator('.media-panel[data-media-state="ready"]')).toHaveCount(5);
    expect(requested.has('29')).toBe(false);
    expect(requested.size).toBeLessThan(10);
    await page.locator('.record-cell').last().scrollIntoViewIfNeeded();
    await expect(page.locator('.record-cell').last().locator('.media-panel[data-media-state="ready"]')).toHaveCount(5);
    expect(requested.has('29')).toBe(true);
});

test('a failed experiment can be retried without reloading a healthy comparison column', async ({ page }) => {
    let baselineRequests = 0, candidateRequests = 0;
    await page.route(recordsRoute, route => ++baselineRequests === 1 ? route.fulfill({ status: 422, json: { error: { message: 'Unavailable' } } }) : route.continue());
    page.on('request', request => { if (request.url().includes('/exps/candidate/records')) candidateRequests++; });
    await openPage(page, `${single},refseg:sior-t:candidate:b`);
    await expect(page.locator('.sample-meta').first()).toBeVisible();
    await page.getByRole('button', { name: 'Retry column 1', exact: true }).click();
    await expect(page.getByText('4 comparison rows · page 1 of 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry column 1', exact: true })).toHaveCount(0);
    expect(baselineRequests).toBe(2);
    expect(candidateRequests).toBe(1);
});

test('Reload data revalidates already displayed thumbnails', async ({ page }) => {
    let attempts = 0;
    page.on('request', request => { if (request.url().endsWith(thumbnail)) attempts++; });
    await openPage(page, single);
    await expect(page.locator('.record-cell').first().locator('.media-panel').first()).toHaveAttribute('data-media-state', 'ready');
    const before = attempts;
    await page.getByRole('button', { name: 'Reload data', exact: true }).click();
    await expect.poll(() => attempts).toBeGreaterThan(before);
    await expect(page.locator('.record-cell').first().locator('.media-panel').first()).toHaveAttribute('data-media-state', 'ready');
});
