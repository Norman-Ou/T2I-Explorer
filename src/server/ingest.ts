import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readdir, lstat, copyFile, rename, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCollection, loadExperiment, requireId, safeFile } from './dataFormat.js';
async function cloneTree(source: string, destination: string) {
    if ((await lstat(source)).isSymbolicLink())
        throw new Error('Symbolic links cannot be imported');
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            throw new Error('Symbolic links cannot be imported');
        const from = path.join(source, entry.name), to = path.join(destination, entry.name);
        if (entry.isDirectory())
            await cloneTree(from, to);
        else if (entry.isFile())
            await copyFile(from, to, constants.COPYFILE_FICLONE);
        else
            throw new Error('Unsupported file type');
    }
}
async function treeDigest(root: string): Promise<string> {
    const hash = createHash('sha256');
    async function visit(dir: string) {
        for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink())
                throw new Error('Symbolic links cannot be imported');
            hash.update(path.relative(root, file));
            if (entry.isDirectory())
                await visit(file);
            else if(entry.isFile())
                hash.update(await readFile(file));
            else throw new Error("Unsupported file type");
        }
    }
    await visit(root);
    return hash.digest('hex');
}
async function exists(file: string) { try {
    await lstat(file);
    return true;
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return false;
    throw error;
} }
async function publish(stage: string, root: string, id: string, replace: boolean) {
    const target = path.join(root, requireId(id));
    let backup: string | undefined;
    if (await exists(target)) {
        if (!replace)
            throw new Error('Collection already exists; use --replace');
        const backupRoot = path.join(root, '.backups');
        await mkdir(backupRoot, { recursive: true });
        backup = path.join(backupRoot, `${id}-${Date.now()}-${randomUUID()}`);
        await rename(target, backup);
    }
    try {
        await rename(stage, target);
    }
    catch (error) {
        if (backup)
            await rename(backup, target);
        throw error;
    }
    return { target, backup };
}
async function withLock<T>(root: string, action: () => Promise<T>) {
    await mkdir(root, { recursive: true });
    const lock = path.join(root, '.import-lock');
    await mkdir(lock);
    try {
        return await action();
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
export async function publishCollection(source: string, root: string, replace = false) {
    source = path.resolve(source);
    root = path.resolve(root);
    if (source === root || root.startsWith(source + path.sep))
        throw new Error('Destination cannot be inside source');
    return withLock(root, async () => {
        const loaded = await loadCollection(source), before = await treeDigest(source), stage = path.join(root, `.staging-${randomUUID()}`);
        try {
            await cloneTree(source, stage);
            await loadCollection(stage);
            if (before !== await treeDigest(source) || before !== await treeDigest(stage))
                throw new Error('Source changed or copied resources differ');
            return await publish(stage, root, loaded.manifest.id, replace);
        }
        finally {
            await rm(stage, { recursive: true, force: true });
        }
    });
}
export async function publishExperiment(source: string, root: string, collectionId: string, taskId: string, datasetId: string, replace = false) {
    source = path.resolve(source);
    root = path.resolve(root);
    if(source === root || root.startsWith(source + path.sep)) throw new Error('Destination cannot be inside source');
    [collectionId, taskId, datasetId].forEach(requireId);
    return withLock(root, async () => {
        const currentRoot = await safeFile(root, collectionId), current = await loadCollection(currentRoot), incoming = await loadExperiment(source);
        const dataset = current.manifest.tasks.find(t => t.id === taskId)?.datasets.find(d => d.id === datasetId);
        if (!dataset)
            throw new Error('Task/dataset must already be declared in collection.json');
        const existing = dataset.exps.find(e => e.id === incoming.manifest.id);
        if (existing && !replace)
            throw new Error('Experiment already exists; use --replace');
        const before = await treeDigest(source), currentBefore = await treeDigest(currentRoot), stage = path.join(root, `.staging-${randomUUID()}`);
        try {
            await cloneTree(currentRoot, stage);
            const expPath = path.join(stage, 'tasks', taskId, 'datasets', datasetId, 'exps', incoming.manifest.id);
            await rm(expPath, { recursive: true, force: true });
            await cloneTree(source, expPath);
            if (!existing)
                dataset.exps.push({ id: incoming.manifest.id });
            await writeFile(path.join(stage, 'collection.json'), JSON.stringify(current.manifest, null, 2) + '\n');
            await loadCollection(stage);
            if (before !== await treeDigest(source) || before !== await treeDigest(expPath) || currentBefore !== await treeDigest(currentRoot))
                throw new Error('Source changed or copied resources differ');
            return await publish(stage, root, collectionId, true);
        }
        finally {
            await rm(stage, { recursive: true, force: true });
        }
    });
}
