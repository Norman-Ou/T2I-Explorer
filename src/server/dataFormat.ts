import { createHash } from 'node:crypto';
import { lstat, realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { imageSize } from 'image-size';
import { collectionSchema, experimentSchema, sampleSchema, idPattern, type CollectionManifest, type ExperimentManifest, type SampleRecord, type Collection, type PanelView } from '../shared/contracts.js';
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateCollection = ajv.compile<CollectionManifest>(collectionSchema);
const validateExperiment = ajv.compile<ExperimentManifest>(experimentSchema);
const validateSample = ajv.compile<SampleRecord>(sampleSchema);
export function requireId(value: string) { if (!new RegExp(idPattern).test(value) || value === '.' || value === '..')
    throw new Error('Invalid identifier'); return value; }
export async function safeFile(root: string, relative: string) {
    if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..'))
        throw new Error('Unsafe resource path');
    if ((await lstat(root)).isSymbolicLink())
        throw new Error('Symbolic roots are not allowed');
    let cursor = root;
    for (const part of relative.split('/')) {
        cursor = path.join(cursor, part);
        if ((await lstat(cursor)).isSymbolicLink())
            throw new Error('Symbolic resources are not allowed');
    }
    const canonical = await realpath(cursor), base = await realpath(root);
    if (!canonical.startsWith(base + path.sep))
        throw new Error('Resource path escapes its root');
    return canonical;
}
export async function boundedRead(root: string, relative: string, limit = 1024 * 1024) {
    const file = await safeFile(root, relative), info = await stat(file);
    if (!info.isFile() || info.size > limit)
        throw new Error('Resource byte limit exceeded');
    return readFile(file);
}
function inspectJson(value: unknown) {
    const pending = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
        const item = pending.pop()!;
        if (++nodes > 50000 || item.depth > 100)
            throw new Error('JSON resource limits exceeded');
        if (item.value && typeof item.value === 'object')
            for (const child of Object.values(item.value))
                pending.push({ value: child, depth: item.depth + 1 });
    }
}
async function readJson(root: string, file: string) { const data = JSON.parse((await boundedRead(root, file)).toString()); inspectJson(data); return data; }
function unique(ids: string[], context: string) { if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate ${context}`); }
export type LoadedExperiment = {
    root: string;
    manifest: ExperimentManifest;
    records: SampleRecord[];
    panels: Map<string, {
        file: string;
        descriptor: PanelView;
    }>;
};
export type LoadedCollection = {
    manifest: CollectionManifest;
    collection: Collection;
    experiments: Map<string, LoadedExperiment>;
    snapshot: string;
};
export function experimentKey(task: string, dataset: string, exp: string) { return [task, dataset, exp].join(':'); }
export function requireAssetPath(asset: string) {
    if (!asset.startsWith('assets/') || asset.includes('\\') || asset.split('/').some(part => !part || part === '.' || part === '..'))
        throw new Error('Unsafe panel asset path');
}
export async function inspectImage(root: string, asset: string) {
    requireAssetPath(asset);
    const file = await safeFile(root, asset);
    const buffer = await boundedRead(root, asset, 50 * 1024 * 1024);
    const ext = path.extname(file).toLowerCase();
    const mime = (ext === '.png' && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ? 'image/png' : ((ext === '.jpg' || ext === '.jpeg') && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') ? 'image/jpeg' : (ext === '.webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ? 'image/webp' : undefined;
    if (!mime)
        throw new Error('Invalid image signature or extension');
    const size = imageSize(buffer);
    if (!size.width || !size.height)
        throw new Error('Invalid image dimensions');
    return { file, media_type: mime, width: size.width, height: size.height };
}
export async function loadExperiment(root: string, options: { validateAssets?: boolean } = {}): Promise<LoadedExperiment> {
    const manifest = await readJson(root, 'experiment.json');
    if (!validateExperiment(manifest))
        throw new Error(`Invalid experiment: ${ajv.errorsText(validateExperiment.errors)}`);
    const raw = (await boundedRead(root, 'samples.jsonl', 100 * 1024 * 1024)).toString();
    const lines = raw === '' ? [] : raw.split('\n');
    if(lines.at(-1) === '') lines.pop();
    if(lines.some(line => line.trim() === '')) throw new Error('Invalid sample: blank JSONL line');
    if (lines.length > 100000)
        throw new Error('Sample count limit exceeded');
    const records: SampleRecord[] = [], panels = new Map<string, {
        file: string;
        descriptor: PanelView;
    }>();
    for (const line of lines) {
        if (Buffer.byteLength(line) > 1024 * 1024)
            throw new Error('Sample byte limit exceeded');
        const record = JSON.parse(line);
        inspectJson(record);
        if (!validateSample(record))
            throw new Error(`Invalid sample: ${ajv.errorsText(validateSample.errors)}`);
        unique(record.panels.map(p => p.id), 'panel ID');
        records.push(record);
    }
    unique(records.map(r => r.sample_id), 'sample ID');
    unique(records.map(r => String(r.index)), 'sample index');
    if (records.length !== manifest.record_count)
        throw new Error('Experiment record count mismatch');
    for (const record of records)
        for (const panel of record.panels)
            if (panel.asset !== null) {
                requireAssetPath(panel.asset);
                const image = options.validateAssets === false
                    ? { file: path.join(root, panel.asset), media_type: undefined, width: undefined, height: undefined }
                    : await inspectImage(root, panel.asset);
                panels.set(`${record.sample_id}:${panel.id}`, { file: image.file, descriptor: { id: panel.id, title: panel.title, status: 'available', media_type: image.media_type, width: image.width, height: image.height } });
            }
    return { root, manifest, records, panels };
}
export async function loadCollection(root: string, options: { validateAssets?: boolean } = {}): Promise<LoadedCollection> {
    const manifest = await readJson(root, 'collection.json');
    if (!validateCollection(manifest))
        throw new Error(`Invalid collection: ${ajv.errorsText(validateCollection.errors)}`);
    unique(manifest.tasks.map(t => t.id), 'task ID');
    const experiments = new Map<string, LoadedExperiment>();
    const collection: Collection = { id: manifest.id, title: manifest.title, description: manifest.description, aliases: manifest.aliases, tasks: [] };
    const hash = createHash('sha256').update(JSON.stringify(manifest));
    for (const task of manifest.tasks) {
        unique(task.datasets.map(d => d.id), 'dataset ID');
        const datasets = [];
        for (const dataset of task.datasets) {
            unique(dataset.exps.map(e => e.id), 'experiment ID');
            const exps = [];
            for (const ref of dataset.exps) {
                const relative = `tasks/${task.id}/datasets/${dataset.id}/exps/${ref.id}`;
                const expRoot = await safeFile(root, relative);
                const loaded = await loadExperiment(expRoot, options);
                if (loaded.manifest.id !== ref.id)
                    throw new Error('Experiment ID does not match its reference');
                experiments.set(experimentKey(task.id, dataset.id, ref.id), loaded);
                const { schema_version: version, ...exp } = loaded.manifest;
                void version;
                exps.push(exp);
                hash.update(JSON.stringify(loaded.manifest));
                hash.update(JSON.stringify(loaded.records));
                for (const panel of options.validateAssets === false ? [] : loaded.panels.values()) {
                    const info = await stat(panel.file);
                    hash.update(`${panel.file}:${info.size}:${info.mtimeMs}`);
                }
            }
            datasets.push({ ...dataset, exps });
        }
        collection.tasks.push({ ...task, datasets });
    }
    return { manifest, collection, experiments, snapshot: hash.digest('hex').slice(0, 24) };
}
