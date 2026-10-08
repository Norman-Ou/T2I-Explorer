// One-off offline migration. The application and ingestion API never read legacy formats.
import { imageExtension } from './image-extension.js';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { loadCollection } from '../src/server/dataFormat.js';
import type { CollectionManifest, ExperimentManifest, SampleRecord, JsonObject } from '../src/shared/contracts.js';
const args = process.argv.slice(2);
function option(name: string) { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
const sourceRoot = path.resolve(option('source') ?? 'data/datasets');
const output = option('output');
if (!output)
    throw new Error('Required: --output <empty staging directory>');
const destination = path.resolve(output);
try {
    await lstat(destination);
    throw new Error('Output already exists; choose a new directory');
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
}
await mkdir(destination, { recursive: true });
const report: Array<{
    collection: string;
    experiments: number;
    samples: number;
    panels: number;
    resource_sha256: string;
}> = [];
const taskTitle = (label: string) => label.split(/[_\s]+/).map(word => /^(gcg|vgd)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
for (const collectionId of ['sft-e6.0-r30', 'basemodel-task-r30']) {
    const oldRoot = path.join(sourceRoot, collectionId), old = JSON.parse(await readFile(path.join(oldRoot, 'manifest.json'), 'utf8'));
    if (old.schema_version !== 2)
        throw new Error('Converter only accepts the audited legacy v2 packages');
    const baseline = collectionId === 'sft-e6.0-r30', expId = baseline ? 'baseline' : 'reference';
    const collection: CollectionManifest = { schema_version: 3, id: collectionId, title: collectionId, tasks: [] };
    let sampleCount = 0, panelCount = 0;
    const digest = createHash('sha256');
    for (const task of old.models) {
        const datasets = [];
        for (const dataset of task.steps) {
            datasets.push({ id: dataset.id, title: dataset.label, data_origin: dataset.data_origin ?? 'native', exps: [{ id: expId }] });
            const rows = JSON.parse(await readFile(path.join(oldRoot, task.id, dataset.id, 'set.json'), 'utf8'));
            const expRoot = path.join(destination, collectionId, 'tasks', task.id, 'datasets', dataset.id, 'exps', expId);
            await mkdir(path.join(expRoot, 'assets'), { recursive: true });
            const manifest: ExperimentManifest = { schema_version: 3, id: expId, title: baseline ? 'Baseline' : 'Reference', record_count: rows.length, metadata: { original_collection_title: old.title, original_experiment: dataset, role: baseline ? 'prediction' : 'source_reference' } };
            const records: SampleRecord[] = [];
            for (const row of rows) {
                const sampleId = createHash('sha256').update(row.source_sample_id).digest('hex');
                const roles = baseline ? ['original_image', 'pred_overlay', 'gt_overlay', 'pred_mask', 'gt_mask'] : ['source', 'model_input', 'reference_output'];
                const titles = baseline ? ['Original', 'Pred overlay', 'GT overlay', 'Pred mask', 'GT mask'] : row.panel_roles;
                const files: string[] = baseline ? roles.map(role => row.asset_paths[role]?.[0]) : row.evidence.panel_asset_paths;
                if (!files || files.length !== roles.length || files.some(file => typeof file !== 'string'))
                    throw new Error('Missing original independent panel assets');
                const panels = [];
                for (let i = 0; i < roles.length; i++) {
                    const file = files[i]!, bytes = await readFile(file);
                    const sha = createHash('sha256').update(bytes).digest('hex');
                    const relative = `assets/${sampleId}/${roles[i]}${imageExtension(bytes)}`;
                    await mkdir(path.dirname(path.join(expRoot, relative)), { recursive: true });
                    await copyFile(file, path.join(expRoot, relative), constants.COPYFILE_FICLONE);
                    if (createHash('sha256').update(await readFile(path.join(expRoot, relative))).digest('hex') !== sha)
                        throw new Error('Resource checksum mismatch');
                    digest.update(sha);
                    panelCount++;
                    panels.push({ id: roles[i]!, title: titles[i]!, asset: relative });
                }
                const extra_texts = [];
                if (!baseline && row.message_output_text !== null && row.message_output_text !== undefined)
                    extra_texts.push({ title: 'Reference output text', text: row.message_output_text });
                if (row.paper_input_text !== undefined)
                    extra_texts.push({ title: 'Paper input text', text: row.paper_input_text });
                if (row.paper_output_text !== undefined)
                    extra_texts.push({ title: 'Paper output text', text: row.paper_output_text });
                if (row.source_annotation_text !== undefined && row.source_annotation_text !== null)
                    extra_texts.push({ title: 'Source annotation text', text: row.source_annotation_text });
                const record: SampleRecord = { sample_id: sampleId, index: row.sample_index, input_text: row.message_input_text, pred_text: baseline ? row.message_output_text : null, gt_text: row.ground_truth_output_text ?? null, panels, extra_texts, metadata: { source_sample_id: row.source_sample_id, original_record: row as JsonObject } };
                // Compare nullable text explicitly, preserving empty strings.
                if (record.input_text !== row.message_input_text || (baseline && record.pred_text !== row.message_output_text) || record.gt_text !== (row.ground_truth_output_text ?? null))
                    throw new Error('Text changed during conversion');
                records.push(record);
                sampleCount++;
            }
            await writeFile(path.join(expRoot, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
            await writeFile(path.join(expRoot, 'samples.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
        }
        collection.tasks.push({ id: task.id, title: taskTitle(task.label), datasets });
    }
    await writeFile(path.join(destination, collectionId, 'collection.json'), JSON.stringify(collection, null, 2) + '\n');
    const loaded = await loadCollection(path.join(destination, collectionId));
    report.push({ collection: collectionId, experiments: loaded.experiments.size, samples: sampleCount, panels: panelCount, resource_sha256: digest.digest('hex') });
    console.log(JSON.stringify(report.at(-1)));
}
await writeFile(path.join(destination, 'conversion-report.json'), JSON.stringify(report, null, 2) + '\n');
