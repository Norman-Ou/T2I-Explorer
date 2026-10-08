import { expect, it } from 'vitest';
import { alignRows, filterRows, orderRows, type LoadedColumn } from '../src/shared/order.js';
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
it('preserves duplicate columns and applies GT search and deterministic shuffle after alignment', () => {
    const a = column('a', 'baseline', ['A', 'B', 'C']), b = { ...a, key: 'duplicate' };
    a.data!.records[1]!.gt_text = 'unique target';
    const rows = alignRows([a, b]);
    expect(rows[0]?.records.size).toBe(2);
    expect(filterRows(rows, 'unique target')).toHaveLength(1);
    expect(orderRows(rows, 'shuffle', 10)).toEqual(orderRows(rows, 'shuffle', 10));
    expect(orderRows(rows, 'id', 0).map(r => r.sampleIndex)).toEqual([1, 2, 3]);
});
