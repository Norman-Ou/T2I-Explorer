import { expect, it } from 'vitest';
import { parseViewState, serializeViewState, tupleParts, activeParts } from '../src/client/urlState.js';
it('uses only four-part experiment columns and stable sample identities', () => {
    expect(tupleParts('task:source:baseline:instance')).toEqual({ taskId: 'task', datasetId: 'source', expId: 'baseline', instanceId: 'instance' });
    expect(tupleParts('task:source:old')).toBeUndefined();
    expect(activeParts('task:source:baseline:instance:stable-A')).toEqual({ key: 'task:source:baseline:instance', sampleId: 'stable-A' });
});
it('roundtrips duplicate stream instances, mode, search and active stable sample', () => {
    const state = parseViewState('?dataset=sft-e6.0-r30&mode=exp&cols=t:d:e:a,t:d:e:b&active=t:d:e:b:sample-X&q=airplane&order=shuffle&seed=78&page=2&pageSize=10');
    expect(parseViewState(serializeViewState(state))).toEqual(state);
    expect(state.columns).toHaveLength(2);
    expect(serializeViewState(state)).not.toMatch(/order=|seed=/);
    expect(state).not.toHaveProperty('order');
    expect(state).not.toHaveProperty('seed');
});
it('rejects old column URLs, unsafe tuples and malformed pagination', () => {
    const state = parseViewState('?dataset=../secret&cols=t:d:old,t:d:e:ok,t:d:e:ok&active=t:d:old:1&page=-1&seed=-2&pageSize=30');
    expect(state.datasetId).toBeUndefined();
    expect(state.columns).toEqual(['t:d:e:ok']);
    expect(state.active).toBeUndefined();
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(25);
});
it('normalizes a read-only collection alias while preserving the complete linked view', async () => {
    const { canonicalViewState } = await import('../src/client/urlState.js');
    const state = parseViewState('?dataset=sft-e6.1-r30&mode=exp&cols=t:d:e:a&active=t:d:e:a:sample-X&q=bridge&page=2&pageSize=10');
    expect(canonicalViewState(state, [{ id: 'sft-e6-r30', aliases: ['sft-e6.1-r30'] }])).toEqual({ ...state, datasetId: 'sft-e6-r30' });
});
