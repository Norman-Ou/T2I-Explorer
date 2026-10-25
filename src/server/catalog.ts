import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogResponse, Diagnostic, ExperimentResponse, SampleView } from '../shared/contracts.js';
import { loadCollection, safeFile, requireId, experimentKey, type LoadedCollection } from './dataFormat.js';
export class CatalogStore {
    private entries = new Map<string, LoadedCollection>();
    private aliases = new Map<string, string>();
    private diagnostics: Diagnostic[] = [];
    private snapshot = 'empty';
    private signature = '';
    private checked = 0;
    private pending?: Promise<void>;
    private refreshError?: Diagnostic;
    constructor(private root: string) { this.root = path.resolve(root); }
    private async fingerprint() {
        const hash = createHash('sha256');
        const failures = new Set<string>();
        async function visit(dir:string,depth:number) {
            if(depth>20) throw new Error('Directory nesting limit exceeded');
            for(const entry of (await readdir(dir,{withFileTypes:true})).filter(e=>!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))) {
                // Assets are validated/versioned individually by the media endpoint.
                if (depth === 6 && entry.name === 'assets') continue;
                const file=path.join(dir,entry.name),info=await lstat(file);
                hash.update(`${file}:${info.size}:${info.mtimeMs}:${info.ino}`);
                if(entry.isDirectory()&&!entry.isSymbolicLink()) await visit(file,depth+1);
            }
        }
        let roots:Dirent[];
        try { roots=await readdir(this.root,{withFileTypes:true}); }
        catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;roots=[];}
        for(const entry of roots.filter(e=>!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))) {
            hash.update(entry.name);
            try {await visit(path.join(this.root,entry.name),0);}
            catch {failures.add(entry.name);hash.update('invalid traversal');}
        }
        return {signature:hash.digest('hex'),failures};
    }
    async initialize() { await this.reload(true); }
    ensureFresh() {
        void this.reload(false).catch(() => {
            this.refreshError = { severity: 'warning', code: 'REFRESH_FAILED', message: 'Background refresh failed. The previous catalog is still available.' };
        });
    }
    async reload(force = false) {
        if (this.pending) {
            await this.pending;
            return this.catalog();
        }
        if (!force && Date.now() - this.checked < 1000)
            return this.catalog();
        this.pending = (async () => {
            this.checked = Date.now();
            const {signature,failures} = await this.fingerprint();
            if (!force && signature === this.signature)
                return;
            const entries = new Map<string, LoadedCollection>(), diagnostics: Diagnostic[] = [];
            let dirs: Dirent[];
            try {
                dirs = await readdir(this.root, { withFileTypes: true });
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw error;
                dirs = [];
            }
            if (dirs.length > 1000)
                throw new Error('Collection count limit exceeded');
            for (const dir of dirs.filter(d => !d.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
                if (!dir.isDirectory())
                    continue;
                try {
                    if(failures.has(dir.name)) throw new Error('Collection directory traversal failed');
                    requireId(dir.name);
                    const collectionRoot = await safeFile(this.root, dir.name);
                    const loaded = await loadCollection(collectionRoot, { validateAssets: false });
                    if (loaded.manifest.id !== dir.name)
                        throw new Error('Collection directory and ID differ');
                    entries.set(dir.name, loaded);
                }
                catch {
                    diagnostics.push({ severity: 'error', code: 'COLLECTION_INVALID', message: 'Collection failed package validation. Run the data CLI to inspect it.', collection_id: dir.name });
                }
            }
            const aliases = new Map<string, string>();
            for (const [id, entry] of entries) {
                for (const alias of entry.manifest.aliases ?? []) {
                    if (entries.has(alias) || aliases.has(alias))
                        throw new Error('Collection alias conflicts with another identity');
                    aliases.set(alias, id);
                }
            }
            this.aliases = aliases;
            this.entries = entries;
            this.refreshError = undefined;
            this.diagnostics = diagnostics;
            this.signature = signature;
            this.snapshot = createHash('sha256').update([...entries].map(([id, e]) => id + e.snapshot).join('|') + JSON.stringify(diagnostics)).digest('hex').slice(0, 24);
        })();
        try {
            await this.pending;
        }
        finally {
            this.pending = undefined;
        }
        return this.catalog();
    }
    catalog(): CatalogResponse { return { snapshot_id: this.snapshot, collections: [...this.entries.values()].map(e => e.collection), diagnostics: [...this.diagnostics, ...(this.refreshError ? [this.refreshError] : [])] }; }
    private canonical(id: string) { requireId(id); return this.aliases.get(id) ?? id; }
    private experiment(collection: string, task: string, dataset: string, exp: string) {
        [collection, task, dataset, exp].forEach(requireId);
        collection = this.canonical(collection);
        const entry = this.entries.get(collection), loaded = entry?.experiments.get(experimentKey(task, dataset, exp));
        if (!entry || !loaded)
            throw new Error('Declared experiment is unavailable');
        return { entry, loaded };
    }
    async getExperiment(collection: string, task: string, dataset: string, exp: string): Promise<ExperimentResponse> {
        collection = this.canonical(collection);
        const { entry, loaded } = this.experiment(collection, task, dataset, exp);
        const records: SampleView[] = loaded.records.map(record => ({ ...record, panels: record.panels.map(panel => {
                const descriptor = loaded.panels.get(`${record.sample_id}:${panel.id}`)?.descriptor;
                const url = `/api/media/${[collection, task, dataset, exp, record.sample_id, panel.id].map(encodeURIComponent).join('/')}`;
                return descriptor ? { ...descriptor, url, thumbnail_url: `${url}?variant=thumbnail` } : { id: panel.id, title: panel.title, status: 'missing', unavailable_reason: panel.unavailable_reason };
            }) }));
        return { collection_id: collection, task_id: task, dataset_id: dataset, exp_id: exp, snapshot_id: entry.snapshot, records, diagnostics: [] };
    }
    async getPanel(collection: string, task: string, dataset: string, exp: string, sample: string, panel: string) {
        [sample, panel].forEach(requireId);
        collection = this.canonical(collection);
        const { loaded } = this.experiment(collection, task, dataset, exp);
        const declared = loaded.records.find(r => r.sample_id === sample)?.panels.find(p => p.id === panel);
        if (!declared?.asset)
            throw new Error('Panel is unavailable');
        // Recheck every ancestor from the trusted data root, even on cached media requests.
        const root = await safeFile(this.root, `${collection}/tasks/${task}/datasets/${dataset}/exps/${exp}`);
        return { root, asset: declared.asset };
    }
}
