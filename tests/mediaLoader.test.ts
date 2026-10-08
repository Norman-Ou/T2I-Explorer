import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaLoader, type MediaState } from '../src/client/mediaLoader.js';

const releases: Array<() => void> = [];
beforeEach(() => {
    vi.useFakeTimers();
    let next = 0;
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL = vi.fn(() => `blob:test-${next++}`);
        static revokeObjectURL = vi.fn();
    });
});
afterEach(() => { releases.splice(0).forEach(release => release()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function subscribe(loader: MediaLoader, url: string, kind: 'thumbnail' | 'original' = 'thumbnail') {
    const states: MediaState[] = [];
    const subscription = loader.subscribe(url, kind, state => states.push(state));
    releases.push(subscription.unsubscribe);
    return { states, ...subscription, last: () => states.at(-1)! };
}

it('bounds preview concurrency, fills free slots around a hanging image and reserves original slots', async () => {
    const complete = new Map<string, () => void>();
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>(resolve => complete.set(url, () => resolve(new Response('image'))))));
    const loader = new MediaLoader();
    const previews = Array.from({ length: 6 }, (_, i) => subscribe(loader, `/preview-${i}`));
    expect([...complete.keys()]).toEqual(['/preview-0', '/preview-1', '/preview-2', '/preview-3']);
    const original = subscribe(loader, '/original', 'original');
    expect(complete.has('/original')).toBe(true);
    complete.get('/preview-1')!();
    complete.get('/original')!();
    await vi.advanceTimersByTimeAsync(0);
    expect(previews[1]!.last().status).toBe('ready');
    expect(original.last().status).toBe('ready');
    expect(previews[0]!.last().status).toBe('loading');
    expect(complete.has('/preview-4')).toBe(true);
    expect(complete.has('/preview-5')).toBe(false);
});

it('retries timeouts independently then allows a fresh manual attempt', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    const item = subscribe(new MediaLoader(), '/hang');
    await vi.advanceTimersByTimeAsync(47_000);
    expect(item.last()).toMatchObject({ status: 'error', error: expect.stringMatching(/timed out/i) });
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockImplementation(() => Promise.resolve(new Response('image')));
    item.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(item.last().status).toBe('ready');
});

it('releases a slot during retry backoff and does not automatically retry permanent errors', async () => {
    const starts: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        starts.push(url);
        if (url === '/busy') return Promise.resolve(new Response('busy', { status: 503 }));
        if (url === '/missing') return Promise.resolve(new Response('missing', { status: 404 }));
        if (url.startsWith('/hang')) return new Promise<Response>(() => {});
        return Promise.resolve(new Response('image'));
    }));
    const loader = new MediaLoader();
    const busy = subscribe(loader, '/busy');
    Array.from({ length: 3 }, (_, i) => subscribe(loader, `/hang-${i}`));
    const healthy = subscribe(loader, '/healthy');
    const missing = subscribe(loader, '/missing');
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.last().status).toBe('retrying');
    expect(healthy.last().status).toBe('ready');
    expect(missing.last().status).toBe('error');
    expect(starts.filter(url => url === '/missing')).toHaveLength(1);
});

it('shares a request and releases its Blob only after the last subscriber leaves', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('image')));
    vi.stubGlobal('fetch', fetch);
    const loader = new MediaLoader();
    const first = subscribe(loader, '/shared'), second = subscribe(loader, '/shared');
    await vi.advanceTimersByTimeAsync(0);
    expect(first.last().src).toBe(second.last().src);
    expect(fetch).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    second.unsubscribe();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-0');
});

it('cancels abandoned queued requests and ongoing requests without retrying them', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url, init) => { signals.push(init.signal); return new Promise<Response>(() => {}); });
    vi.stubGlobal('fetch', fetch);
    const loader = new MediaLoader();
    const items = Array.from({ length: 5 }, (_, i) => subscribe(loader, `/image-${i}`));
    items[4]!.unsubscribe();
    items.slice(0, 4).forEach(item => item.unsubscribe());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(signals.every(signal => signal.aborted)).toBe(true);
});
