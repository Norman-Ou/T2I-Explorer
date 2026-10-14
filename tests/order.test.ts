import { expect, it } from 'vitest';
import { alignRows, filterRows, type LoadedColumn } from '../src/shared/order.js';
import type { SampleView } from '../src/shared/contracts.js';
function sample(sample_id: string, index: number): SampleView { return { sample_id, index, input_text: 'Input ' + sample_id, pred_text: '', gt_text: null, panels: [], metadata: {} }; }
function column(key: string, exp: string, ids: string[], dataset = 'source', expOrder = 0): LoadedColumn { return { key, expOrder, data: { collection_id: 'collection', task_id: 'task', dataset_id: dataset, exp_id: exp, snapshot_id: 's', records: ids.map((id, i) => sample(id, i + 1)), diagnostics: [] } }; }
it('aligns stable IDs with baseline anchor, gaps and new samples, independent of drag order', () => {
    const baseline = column('b', 'baseline', ['A', 'B', 'C']), candidate = column('c', 'candidate', ['C', 'A', 'D'], 'source', 1);
    const rows = alignRows([candidate, baseline]);
    expect(rows.map(r => [r.records.get('b')?.sample_id, r.records.get('c')?.sample_id])).toEqual([['A', 'A'], ['B', undefined], ['C', 'C'], [undefined, 'D']]);
    expect(alignRows([baseline, candidate]).map(r => [...r.records].sort())).toEqual(rows.map(r => [...r.records].sort()));
});
it('uses manifest order when baseline is absent and keeps distinct cohorts ordinal', () => {
    const first = column('a', 'first', ['A', 'B'], 'source', 0), second = column('b', 'second', ['B', 'A'], 'source', 1), other = column('o', 'reference', ['X'], 'other');
    const rows = alignRows([second, other, first]);
    expect(rows[0]?.records.get('a')?.sample_id).toBe('A');
    expect(rows[0]?.records.get('b')?.sample_id).toBe('A');
    expect(rows[0]?.records.get('o')?.sample_id).toBe('X');
    expect(rows[1]?.records.has('o')).toBe(false);
});
it('preserves duplicate columns and fixed order after GT search', () => {
    const a = column('a', 'baseline', ['A', 'B', 'C']), b = { ...a, key: 'duplicate' };
    a.data!.records[1]!.gt_text = 'unique target';
    const rows = alignRows([a, b]);
    expect(rows[0]?.records.size).toBe(2);
    expect(filterRows(rows, 'unique target')).toHaveLength(1);
    expect(rows.map(r => r.sampleIndex)).toEqual([1, 2, 3]);
    expect(filterRows(rows, 'unique target').map(r => r.sampleIndex)).toEqual([2]);
});
it('searches native and pipeline IDs while keeping requests from the same source separate', () => {
    const baseline = column('b', 'baseline', ['request-A', 'request-B', 'request-C']);
    baseline.data!.records[0]!.metadata = { source_sample_id: 'pipeline-A', original_record: { evidence: { source_id: 'scene-001.tiff' } } };
    baseline.data!.records[1]!.metadata = { source_sample_id: 'pipeline-B', evidence: { source_id: 'scene-001.tiff' } };
    const candidate = column('c', 'candidate', ['request-B', 'request-A'], 'source', 1);
    candidate.data!.records.forEach(record => { record.metadata = { source_id: 'scene-001.tiff' }; });
    const rows = alignRows([baseline, candidate]);
    expect(rows).toHaveLength(3);
    const matches = filterRows(rows, 'SCENE-001.TIFF');
    expect(matches.map(row => [row.records.get('b')?.sample_id, row.records.get('c')?.sample_id])).toEqual([['request-A', 'request-A'], ['request-B', 'request-B']]);
    expect(filterRows(rows, 'pipeline-B').map(row => row.records.get('b')?.sample_id)).toEqual(['request-B']);
    expect(filterRows(rows, 'request-A').map(row => row.records.get('b')?.sample_id)).toEqual(['request-A']);
});
