import { mkdtemp, mkdir, writeFile, rm, copyFile, symlink, unlink, readFile, rename, cp } from 'node:fs/promises';
import { imageSize } from 'image-size';
import { loadCollection } from '../src/server/dataFormat.js';
import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
const apps: FastifyInstance[] = [], roots: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const host = { host: '127.0.0.1' };
async function setup() {
    const root = await mkdtemp(path.join(os.tmpdir(), 't2i-api-'));
    roots.push(root);
    const exp = path.join(root, 'mini/tasks/task/datasets/source/exps/baseline');
    await mkdir(path.join(exp, 'assets'), { recursive: true });
    await writeFile(path.join(root, 'mini/collection.json'), JSON.stringify({ schema_version: 3, id: 'mini', title: 'Mini', tasks: [{ id: 'task', title: 'Task', datasets: [{ id: 'source', title: 'Source', data_origin: 'native', exps: [{ id: 'baseline' }] }] }] }));
    await writeFile(path.join(exp, 'experiment.json'), JSON.stringify({ schema_version: 3, id: 'baseline', title: 'Baseline', record_count: 1, metadata: {} }));
    await copyFile('fixtures/datasets/sft-e6.0-r30/tasks/refseg/datasets/sior-t/exps/baseline/assets/original_image.png', path.join(exp, 'assets/original.png'));
    await writeFile(path.join(exp, 'samples.jsonl'), JSON.stringify({ sample_id: 'stable-A', index: 57, input_text: '', pred_text: null, gt_text: 'GT', panels: [{ id: 'original', title: 'Original', asset: 'assets/original.png' }, { id: 'mask', title: 'Mask', asset: null, unavailable_reason: 'No mask supplied' }], metadata: {} }) + '\n');
    const app = await buildApp({ dataRoot: root, serveClient: false });
    apps.push(app);
    return { app, root, exp };
}
it('serves sole catalog/record/media routes with authoritative experiment titles and exact text', async () => {
    const { app } = await setup();
    const catalog = await app.inject({ url: '/api/catalog', headers: host });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().collections[0].tasks[0].datasets[0].exps[0].title).toBe('Baseline');
    expect((await app.inject({ url: '/api/catalog', headers: { ...host, 'if-none-match': catalog.headers.etag! } })).statusCode).toBe(304);
    const response = await app.inject({ url: '/api/collections/mini/tasks/task/datasets/source/exps/baseline/records', headers: host });
    expect(response.statusCode).toBe(200);
    const record = response.json().records[0];
    expect(record).toMatchObject({ index: 57, input_text: '', pred_text: null, gt_text: 'GT' });
    expect(record.panels[0]).not.toHaveProperty('asset');
    expect(record.panels[1]).toMatchObject({ status: 'missing', unavailable_reason: 'No mask supplied' });
    const image = await app.inject({ url: record.panels[0].url, headers: host });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect((await app.inject({ url: '/api/media/mini/task/source/baseline/stable-A/undeclared', headers: host })).statusCode).toBe(404);
});
it('rejects all legacy routes and non-allowlisted hosts, enforces reload origin', async () => {
    const { app } = await setup();
    for (const url of ['/api/v2/catalog', '/api/v3/catalog', '/api/v2/health', '/api/v3/datasets/x/y/z/e'])
        expect((await app.inject({ url, headers: host })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/catalog', headers: { host: 'evil.test' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/reload', method: 'POST', headers: { ...host, origin: 'https://evil.test' } })).statusCode).toBe(403);
});
it('revalidates media after replacement with a symlink and invalidates malformed experiments', async () => {
    const { app, exp } = await setup();
    await unlink(path.join(exp, 'assets/original.png'));
    await symlink('/etc/hosts', path.join(exp, 'assets/original.png'));
    expect((await app.inject({ url: '/api/media/mini/task/source/baseline/stable-A/original', headers: host })).statusCode).toBe(404);
    await writeFile(path.join(exp, 'samples.jsonl'), 'invalid json');
    await app.inject({ url: '/api/reload', method: 'POST', headers: host });
    expect((await app.inject({ url: '/api/catalog', headers: host })).json().collections).toEqual([]);
});
it('ignores old-format packages rather than adapting them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 't2i-old-'));
    roots.push(root);
    await mkdir(path.join(root, 'old'));
    await writeFile(path.join(root, 'old/manifest.json'), JSON.stringify({ schema_version: 2, id: 'old', models: [] }));
    const app = await buildApp({ dataRoot: root, serveClient: false });
    apps.push(app);
    expect((await app.inject({ url: '/api/catalog', headers: host })).json().collections).toEqual([]);
});
it('isolates malformed directory traversal and keeps valid collections available',async()=>{
 const {app,root}=await setup();await mkdir(path.join(root,'bad',...Array.from({length:22},(_,i)=>`nested-${i}`)),{recursive:true});
 const response=await app.inject({url:'/api/reload',method:'POST',headers:host});expect(response.statusCode).toBe(200);expect(response.json().collections.map((c:{id:string})=>c.id)).toEqual(['mini']);expect(response.json().diagnostics).toContainEqual(expect.objectContaining({collection_id:'bad',severity:'error'}));
});

it('keeps metadata and healthy panels available when a declared image disappears, while import validation stays strict', async () => {
    const { app, root, exp } = await setup();
    await unlink(path.join(exp, 'assets/original.png'));
    const refreshed = await app.inject({ url: '/api/reload', method: 'POST', headers: host });
    expect(refreshed.json().collections.map((c: { id: string }) => c.id)).toEqual(['mini']);
    const records = await app.inject({ url: '/api/collections/mini/tasks/task/datasets/source/exps/baseline/records', headers: host });
    expect(records.statusCode).toBe(200);
    expect(records.json().records[0].panels[0].url).toBe('/api/media/mini/task/source/baseline/stable-A/original');
    expect((await app.inject({ url: records.json().records[0].panels[0].url, headers: host })).statusCode).toBe(404);
    await expect(loadCollection(path.join(root, 'mini'))).rejects.toThrow();
});

it('serves independent WebP thumbnails and untouched original bytes with separate cache validators', async () => {
    const { app, exp } = await setup();
    const records = (await app.inject({ url: '/api/collections/mini/tasks/task/datasets/source/exps/baseline/records', headers: host })).json();
    const panel = records.records[0].panels[0];
    expect(panel.thumbnail_url).toBe(`${panel.url}?variant=thumbnail`);
    const thumbnail = await app.inject({ url: panel.thumbnail_url, headers: host });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers['content-type']).toBe('image/webp');
    expect(imageSize(thumbnail.rawPayload).width).toBeLessThanOrEqual(512);
    expect(imageSize(thumbnail.rawPayload).height).toBeLessThanOrEqual(512);
    const original = await app.inject({ url: panel.url, headers: host });
    expect(original.rawPayload).toEqual(await readFile(path.join(exp, 'assets/original.png')));
    expect(original.headers.etag).not.toBe(thumbnail.headers.etag);
    expect((await app.inject({ url: panel.thumbnail_url, headers: { ...host, 'if-none-match': thumbnail.headers.etag! } })).statusCode).toBe(304);
    expect((await app.inject({ url: `${panel.url}?variant=unknown`, headers: host })).statusCode).toBe(400);
    await unlink(path.join(exp, 'assets/original.png'));
    await symlink('/etc/hosts', path.join(exp, 'assets/original.png'));
    expect((await app.inject({ url: panel.thumbnail_url, headers: { ...host, 'if-none-match': thumbnail.headers.etag! } })).statusCode).toBe(404);
});

it('downsizes large images and invalidates cached previews when the source is replaced', async () => {
    const { app, exp } = await setup();
    const file = path.join(exp, 'assets/original.png');
    await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#13579b' } }).png().toFile(file);
    const url = '/api/media/mini/task/source/baseline/stable-A/original?variant=thumbnail';
    const first = await app.inject({ url, headers: host });
    expect(first.statusCode).toBe(200);
    expect(imageSize(first.rawPayload)).toMatchObject({ width: 512, height: 256 });
    const cached = await app.inject({ url, headers: host });
    expect(cached.rawPayload).toEqual(first.rawPayload);
    await sharp({ create: { width: 800, height: 1600, channels: 3, background: '#9b5713' } }).png().toFile(file);
    const replaced = await app.inject({ url, headers: { ...host, 'if-none-match': first.headers.etag! } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.headers.etag).not.toBe(first.headers.etag);
    expect(imageSize(replaced.rawPayload)).toMatchObject({ width: 256, height: 512 });
    await writeFile(file, 'corrupt image');
    expect((await app.inject({ url, headers: host })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/catalog', headers: host })).json().collections).toHaveLength(1);
});

it('rejects redirected experiment ancestors even when the thumbnail is cached', async () => {
    const { app, root } = await setup();
    const url = '/api/media/mini/task/source/baseline/stable-A/original';
    const thumbnail = await app.inject({ url: `${url}?variant=thumbnail`, headers: host });
    expect(thumbnail.statusCode).toBe(200);
    const outside = await mkdtemp(path.join(os.tmpdir(), 't2i-external-'));
    roots.push(outside);
    const tasks = path.join(root, 'mini/tasks');
    await cp(tasks, path.join(outside, 'tasks'), { recursive: true });
    await rename(tasks, path.join(root, 'mini/.saved-tasks'));
    await symlink(path.join(outside, 'tasks'), tasks);
    expect((await app.inject({ url, headers: host })).statusCode).toBe(404);
    expect((await app.inject({ url: `${url}?variant=thumbnail`, headers: { ...host, 'if-none-match': thumbnail.headers.etag! } })).statusCode).toBe(404);
});
it('resolves old record and media URLs with one canonical catalog entry', async () => {
    const { app, root } = await setup();
    const manifestPath = path.join(root, 'mini/collection.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, aliases: ['old-mini'] }));
    await app.inject({ url: '/api/reload', method: 'POST', headers: host });
    const catalog = (await app.inject({ url: '/api/catalog', headers: host })).json();
    expect(catalog.collections.map((item: {id: string}) => item.id)).toEqual(['mini']);
    const records = await app.inject({ url: '/api/collections/old-mini/tasks/task/datasets/source/exps/baseline/records', headers: host });
    expect(records.statusCode).toBe(200);
    expect(records.json().collection_id).toBe('mini');
    const canonical = await app.inject({ url: records.json().records[0].panels[0].url, headers: host });
    const old = await app.inject({ url: '/api/media/old-mini/task/source/baseline/stable-A/original', headers: host });
    expect(old.statusCode).toBe(200);
    expect(old.rawPayload).toEqual(canonical.rawPayload);
});
