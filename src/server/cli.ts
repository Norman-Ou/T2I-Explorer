import path from 'node:path';
import { loadCollection } from './dataFormat.js';
import { publishCollection, publishExperiment } from './ingest.js';
const args = process.argv.slice(2), command = args.shift();
function flag(name: string) { const index = args.indexOf(`--${name}`); if (index < 0)
    return undefined; const value = args[index + 1]; if (!value || value.startsWith('--'))
    throw new Error(`Missing --${name} value`); return value; }
try {
    if (command === 'validate') {
        if (!args[0])
            throw new Error('Usage: data validate <collection directory>');
        const result = await loadCollection(path.resolve(args[0]));
        console.log(JSON.stringify({ id: result.collection.id, experiments: result.experiments.size, records: [...result.experiments.values()].reduce((sum, e) => sum + e.records.length, 0) }));
    }
    else if (command === 'import-collection' || command === 'import-exp') {
        const from = flag('from'), root = flag('root');
        if (!from || !root)
            throw new Error('Required: --from <package> --root <data root>');
        const result = command === 'import-collection' ? await publishCollection(from, root, args.includes('--replace')) : await publishExperiment(from, root, flag('collection') ?? '', flag('task') ?? '', flag('dataset') ?? '', args.includes('--replace'));
        console.log(JSON.stringify(result));
    }
    else
        throw new Error('Commands: validate, import-collection, import-exp');
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
