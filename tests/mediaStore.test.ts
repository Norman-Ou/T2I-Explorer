import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaStore } from '../src/server/media.js';

const root = 'fixtures/datasets/sft-e6.0-r30/tasks/refseg/datasets/sior-t/exps/baseline';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('coalesces simultaneous conversions for the same source version', async () => {
    const store = new MediaStore();
    const a = await store.open(root, 'assets/original_image.png'), b = await store.open(root, 'assets/original_image.png');
    const readA = vi.spyOn(a.handle, 'createReadStream'), readB = vi.spyOn(b.handle, 'createReadStream');
    try {
        const [first, second] = await Promise.all([store.thumbnail(a), store.thumbnail(b)]);
        expect(first).toBe(second);
        expect(readA).toHaveBeenCalledTimes(1);
        expect(readB).not.toHaveBeenCalled();
        expect(await store.thumbnail(b)).toBe(first);
        expect(readB).not.toHaveBeenCalled();
    } finally { await Promise.all([a.handle.close(), b.handle.close()]); }
});

it('times out stalled input streams and releases conversion slots for healthy images', async () => {
    const store = new MediaStore();
    const images = await Promise.all(['original_image', 'gt_overlay', 'pred_overlay'].map(id => store.open(root, `assets/${id}.png`)));
    const stalls = [new PassThrough(), new PassThrough()];
    stalls.forEach((stream, i) => vi.spyOn(images[i]!.handle, 'createReadStream').mockReturnValue(stream as never));
    const healthyRead = vi.spyOn(images[2]!.handle, 'createReadStream');
    vi.useFakeTimers();
    const failures: unknown[] = [];
    const jobs = images.map(image => store.thumbnail(image).catch(error => { failures.push(error); return undefined; }));
    try {
        expect(healthyRead).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(failures).toHaveLength(2);
        expect(failures).toEqual([expect.objectContaining({ status: 504 }), expect.objectContaining({ status: 504 })]);
        expect(healthyRead).toHaveBeenCalledTimes(1);
    } finally {
        stalls.forEach(stream => stream.end());
        vi.useRealTimers();
        await Promise.all(jobs);
        await Promise.all(images.map(image => image.handle.close()));
    }
    expect(await jobs[2]).toBeInstanceOf(Buffer);
});
