import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';

const io = vi.hoisted(() => ({ assetReads: 0, assetScans: 0, metadataReads: 0, blocked: false, pause: undefined as Promise<void> | undefined }));
vi.mock('node:fs/promises', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs/promises')>();
    const mocked = {
        ...fs,
        readFile: async (...args: Parameters<typeof fs.readFile>) => {
            if (String(args[0]).includes('/assets/')) io.assetReads++;
            if (String(args[0]).endsWith('.json')) io.metadataReads++;
            if (io.pause && String(args[0]).endsWith('.json')) { io.blocked = true; await io.pause; }
            return fs.readFile(...args);
        },
        readdir: async (...args: Parameters<typeof fs.readdir>) => {
            if (String(args[0]).endsWith('/assets')) io.assetScans++;
            return fs.readdir(...args);
        }
    };
    return { ...mocked, default: mocked };
});
let app: FastifyInstance | undefined;
const host = { host: '127.0.0.1' };
beforeEach(() => { io.assetReads = 0; io.assetScans = 0; io.metadataReads = 0; io.blocked = false; io.pause = undefined; });
afterEach(async () => { await app?.close(); });

it('initializes and refreshes metadata without reading or traversing image assets', async () => {
    app = await buildApp({ dataRoot: 'fixtures/datasets', serveClient: false });
    expect((await app.inject({ url: '/api/reload', method: 'POST', headers: host })).statusCode).toBe(200);
    expect(io.assetReads).toBe(0);
    expect(io.assetScans).toBe(0);
    expect(io.metadataReads).toBeGreaterThan(0);
});

it('serves the current catalog, records and images while a metadata refresh is blocked', async () => {
    app = await buildApp({ dataRoot: 'fixtures/datasets', serveClient: false });
    let release: () => void = () => {};
    io.pause = new Promise<void>(resolve => { release = resolve; });
    const refresh = app.inject({ url: '/api/reload', method: 'POST', headers: host }).then(response => response);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await vi.waitFor(() => expect(io.blocked).toBe(true));
        const requests = Promise.all([
            '/api/catalog',
            '/api/collections/sft-e6.0-r30/tasks/refseg/datasets/sior-t/exps/baseline/records',
            '/api/media/sft-e6.0-r30/refseg/sior-t/baseline/fixture-A/original_image'
        ].map(url => app!.inject({ url, headers: host })));
        const responses = await Promise.race([requests, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Requests waited for the unrelated refresh')), 1000);
        })]);
        expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200]);
    } finally { clearTimeout(timer); release(); io.pause = undefined; await refresh; }
});
