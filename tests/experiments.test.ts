import { expect, it } from 'vitest';
import { loadCollection } from '../src/server/dataFormat.js';
import { buildBrowseTree } from '../src/client/browseTree.js';
it('reads authoritative experiment metadata and keeps task and exp hierarchies symmetric', async () => {
    const { collection } = await loadCollection('fixtures/datasets/sft-e6.0-r30');
    const tasks = buildBrowseTree(collection.tasks, 'task'), exps = buildBrowseTree(collection.tasks, 'exp');
    expect(tasks[0]?.children?.[0]?.children?.map(e => e.label)).toEqual(['Baseline', 'Candidate']);
    expect(exps.map(e => e.label)).toEqual(['Baseline', 'Candidate']);
    expect(exps[1]?.children?.[0]?.children).toHaveLength(1);
});
