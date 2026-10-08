import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/client/api.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries transient GET failures and returns the successful independent result', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ collections: [] })));
    vi.stubGlobal('fetch', fetch);
    const result = api.catalog();
    const check = expect(result).resolves.toEqual({ collections: [] });
    await vi.advanceTimersByTimeAsync(500);
    await check;
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('times out hanging GETs with a bounded retry count', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signals.push(init.signal); return new Promise(() => {}); }));
    const check = expect(api.catalog()).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(62_000);
    await check;
    expect(signals).toHaveLength(3);
    expect(signals.every(signal => signal.aborted)).toBe(true);
});

it('does not retry permanent failures or reload submissions', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.catalog()).rejects.toThrow('Not found');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(api.reload()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('cancels retry backoff without starting another request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('Offline'));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const check = expect(api.catalog(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await check;
    expect(fetch).toHaveBeenCalledTimes(1);
});
