// Small synthetic panel fixtures; never imported into production data.
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CollectionManifest, ExperimentManifest, SampleRecord } from '../src/shared/contracts.js';
const {deflateSync}=await import('node:zlib');
// Small colored synthetic PNGs keep test packages portable and independent of production images.
function fixturePng(role:number):Buffer {
 const crc=(buffer:Buffer)=>{let value=0xffffffff;for(const byte of buffer){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 const chunk=(type:string,data:Buffer)=>{const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(24,0);header.writeUInt32BE(24,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(24*(1+24*3));for(let y=0;y<24;y++)for(let x=0;x<24;x++){const offset=y*73+1+x*3;pixels[offset]=40+role*35;pixels[offset+1]=80+x*4;pixels[offset+2]=100+y*3;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const stage = 'fixtures/.new-datasets';
await rm(stage, { recursive: true, force: true });
const roles = ['original_image', 'pred_overlay', 'gt_overlay', 'pred_mask', 'gt_mask'];
const titles = ['Original', 'Pred overlay', 'GT overlay', 'Pred mask', 'GT mask'];
async function experiment(collection: string, task: string, dataset: string, exp: string, ids: string[], count = 5) {
    const root = path.join(stage, collection, 'tasks', task, 'datasets', dataset, 'exps', exp);
    await mkdir(path.join(root, 'assets'), { recursive: true });
    for (let i = 0; i < count; i++)
        await writeFile(path.join(root, 'assets', `${roles[i]}.png`),fixturePng(i));
    const manifest: ExperimentManifest = { schema_version: 3, id: exp, title: exp === 'baseline' ? 'Baseline' : exp === 'reference' ? 'Reference' : 'Candidate', record_count: ids.length, metadata: { fixture: true } };
    await writeFile(path.join(root, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
    const samples: SampleRecord[] = ids.map((sample_id, i) => ({ sample_id, index: i + 1, input_text: `<SEG> Segment fixture ${sample_id}`, pred_text: '', gt_text: i === 0 ? '<p>airplane-3<color>(254, 91, 109)</color></p>' : null, panels: roles.slice(0, count).map((id, j) => ({ id, title: titles[j]!, asset: `assets/${id}.png` })), metadata: { fixture: true } }));
    await writeFile(path.join(root, 'samples.jsonl'), samples.map(s => JSON.stringify(s)).join('\n') + (samples.length ? '\n' : ''));
}
const sft: CollectionManifest = { schema_version: 3, id: 'sft-e6.0-r30', title: 'sft-e6.0-r30', tasks: [{ id: 'refseg', title: 'RefSeg', datasets: [{ id: 'sior-t', title: 'SIOR_T', data_origin: 'native', exps: [{ id: 'baseline' }, { id: 'candidate' }] }, { id: 'fast-t', title: 'FAST_T', data_origin: 'derived', exps: [{ id: 'baseline' }] }] }, { id: 'gcg', title: 'GCG', datasets: [{ id: 'preview', title: 'Preview', data_origin: 'native', exps: [{ id: 'baseline' }] }] }] };
const reference: CollectionManifest = { schema_version: 3, id: 'basemodel-task-r30', title: 'basemodel-task-r30', tasks: [{ id: 'refseg', title: 'RefSeg', datasets: [{ id: 'official', title: 'Official', data_origin: 'native', exps: [{ id: 'reference' }] }] }] };
for (const manifest of [sft, reference]) {
    await mkdir(path.join(stage, manifest.id), { recursive: true });
    await writeFile(path.join(stage, manifest.id, 'collection.json'), JSON.stringify(manifest, null, 2) + '\n');
}
await experiment(sft.id, 'refseg', 'sior-t', 'baseline', ['fixture-A', 'fixture-B', 'fixture-C']);
await experiment(sft.id, 'refseg', 'sior-t', 'candidate', ['fixture-C', 'fixture-A', 'fixture-D']);
await experiment(sft.id, 'refseg', 'fast-t', 'baseline', ['other-X', 'other-Y'], 3);
await experiment(sft.id, 'gcg', 'preview', 'baseline', [], 3);
await experiment(reference.id, 'refseg', 'official', 'reference', [], 3);
await rm('fixtures/datasets', { recursive: true, force: true });
const { rename } = await import('node:fs/promises');
await rename(stage, 'fixtures/datasets');
