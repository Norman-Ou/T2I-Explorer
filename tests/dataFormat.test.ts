import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadCollection } from '../src/server/dataFormat.js';
import { publishCollection, publishExperiment } from '../src/server/ingest.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
export async function bundle() {
    const root = await mkdtemp(path.join(os.tmpdir(), 't2i-clean-'));
    roots.push(root);
    const exp = path.join(root, 'tasks/task/datasets/source/exps/baseline');
    await mkdir(exp, { recursive: true });
    await writeFile(path.join(root, 'collection.json'), JSON.stringify({ schema_version: 3, id: 'mini', title: 'Mini', tasks: [{ id: 'task', title: 'Task', datasets: [{ id: 'source', title: 'Source', data_origin: 'derived', exps: [{ id: 'baseline' }] }] }] }));
    await writeFile(path.join(exp, 'experiment.json'), JSON.stringify({ schema_version: 3, id: 'baseline', title: 'Baseline', record_count: 1, metadata: { checkpoint: '50' } }));
    const sample = { sample_id: 'stable-A', index: 42, input_text: '', pred_text: null, gt_text: '<p>x</p>', panels: [{ id: 'original', title: 'Original', asset: null, unavailable_reason: 'Not provided' }], metadata: {} };
    await writeFile(path.join(exp, 'samples.jsonl'), JSON.stringify(sample) + '\n');
    return { root, exp, sample };
}
it('loads complete experiments, arbitrary indices, explicit missing panels and exact nullable text', async () => {
    const { root } = await bundle();
    const result = await loadCollection(root);
    expect(result.collection.tasks[0]?.datasets[0]?.exps[0]?.title).toBe('Baseline');
    expect([...result.experiments.values()][0]?.records[0]).toMatchObject({ sample_id: 'stable-A', index: 42, input_text: '', pred_text: null, gt_text: '<p>x</p>' });
});
it('rejects duplicate identities, legacy records and undeclared unsafe asset paths', async () => {
    const { root, exp, sample } = await bundle();
    await writeFile(path.join(exp, 'samples.jsonl'), [sample, sample].map(x => JSON.stringify(x)).join('\n'));
    await expect(loadCollection(root)).rejects.toThrow(/duplicate/i);
    await writeFile(path.join(exp, 'samples.jsonl'), JSON.stringify({ sample_index: 1, source_sample_id: 'old' }));
    await expect(loadCollection(root)).rejects.toThrow(/sample/i);
    await writeFile(path.join(exp, 'samples.jsonl'), JSON.stringify({ ...sample, panels: [{ id: 'p', title: 'Panel', asset: '../../secret.png' }] }));
    await expect(loadCollection(root)).rejects.toThrow(/asset|path/i);
});
it('rejects symlinked resources and accidental missing files', async () => {
    const { root, exp, sample } = await bundle();
    await mkdir(path.join(exp, 'assets'));
    await symlink('/etc/hosts', path.join(exp, 'assets/image.png'));
    await writeFile(path.join(exp, 'samples.jsonl'), JSON.stringify({ ...sample, panels: [{ id: 'p', title: 'Panel', asset: 'assets/image.png' }] }));
    await expect(loadCollection(root)).rejects.toThrow(/symbolic/i);
});
it('publishes validated collections atomically, requires explicit replacement, and backs up originals', async () => {
    const { root } = await bundle();
    const destination = await mkdtemp(path.join(os.tmpdir(), 't2i-publish-'));
    roots.push(destination);
    await publishCollection(root, destination);
    await expect(publishCollection(root, destination)).rejects.toThrow(/exists/i);
    const result = await publishCollection(root, destination, true);
    expect(result.backup).toBeTruthy();
    expect(await readFile(path.join(result.backup!, 'collection.json'), 'utf8')).toContain('Mini');
});
it('imports a complete experiment and updates source references without overwriting baseline', async () => {
    const { root, exp } = await bundle();
    const destination = await mkdtemp(path.join(os.tmpdir(), 't2i-exp-'));
    roots.push(destination);
    await publishCollection(root, destination);
    await writeFile(path.join(exp, 'experiment.json'), JSON.stringify({ schema_version: 3, id: 'candidate', title: 'Candidate', record_count: 1, metadata: {} }));
    await publishExperiment(exp, destination, 'mini', 'task', 'source');
    const result = await loadCollection(path.join(destination, 'mini'));
    expect(result.collection.tasks[0]?.datasets[0]?.exps.map(x => x.id)).toEqual(['baseline', 'candidate']);
    await expect(publishExperiment(exp, destination, 'mini', 'task', 'source')).rejects.toThrow(/exists/i);
});
it('rejects extra trailing JSONL blank lines and whitespace-only zero-record files',async()=>{
 const {root,exp,sample}=await bundle();await writeFile(path.join(exp,'samples.jsonl'),JSON.stringify(sample)+'\n\n');await expect(loadCollection(root)).rejects.toThrow(/blank/i);
 await writeFile(path.join(exp,'experiment.json'),JSON.stringify({schema_version:3,id:'baseline',title:'Baseline',record_count:0,metadata:{}}));await writeFile(path.join(exp,'samples.jsonl'),' \n');await expect(loadCollection(root)).rejects.toThrow(/blank/i);
});
it('rejects experiment destination inside source before creating locks or copying',async()=>{
 const {exp}=await bundle();await expect(publishExperiment(exp,path.join(exp,'destination'),'mini','task','source')).rejects.toThrow(/inside source/i);
});
it('refuses writes through a collection alias instead of recreating the retired collection', async () => {
    const { root, exp } = await bundle();
    const manifestPath = path.join(root, 'collection.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, aliases: ['retired'] }));
    const destination = await mkdtemp(path.join(os.tmpdir(), 't2i-alias-'));
    roots.push(destination);
    await publishCollection(root, destination);
    await expect(publishExperiment(exp, destination, 'retired', 'task', 'source')).rejects.toThrow(/read-only alias.*mini/);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, id: 'retired' }));
    await expect(publishCollection(root, destination)).rejects.toThrow(/read-only alias.*mini/);
});
