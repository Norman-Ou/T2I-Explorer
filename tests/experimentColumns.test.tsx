import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useExperimentColumns } from '../src/client/useExperimentColumns.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('renders healthy experiments independently and retries only a failed column', async () => {
    let broken = true;
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(url.includes('/bad/') && broken
            ? new Response(JSON.stringify({ error: { message: 'Unavailable' } }), { status: 422 })
            : new Response(JSON.stringify({ records: [], snapshot_id: 's' })));
    }));
    const { result } = renderHook(() => useExperimentColumns('collection', ['task:source:bad:a', 'task:source:good:b'], 'snapshot'));
    await waitFor(() => expect(result.current.columns.get('task:source:bad:a')?.error).toBe('Unavailable'));
    expect(result.current.columns.get('task:source:good:b')?.data?.records).toEqual([]);
    broken = false;
    act(() => result.current.retry('task:source:bad:a'));
    await waitFor(() => expect(result.current.columns.get('task:source:bad:a')?.data?.records).toEqual([]));
    expect(urls.filter(url => url.includes('/good/'))).toHaveLength(1);
    expect(urls.filter(url => url.includes('/bad/'))).toHaveLength(2);
});

it('bounds pending experiment requests and cancels both active and queued work on unmount', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signals.push(init.signal); return new Promise(() => {}); }));
    const keys = Array.from({ length: 7 }, (_, i) => `task:source:exp${i}:a`);
    const { unmount } = renderHook(() => useExperimentColumns('collection', keys, 'snapshot'));
    expect(signals).toHaveLength(4);
    unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await Promise.resolve();
    expect(signals).toHaveLength(4);
});
