import { expect, it } from 'vitest';
import type { JsonObject } from '../src/shared/contracts.js';
import { sampleIdentity } from '../src/shared/sampleIdentity.js';

const identity = (metadata: JsonObject) => sampleIdentity({ sample_id: 'internal-request', metadata });

it('reads source identity from both published E6 provenance layouts', () => {
    expect(identity({ source_sample_id: 'native-request', source_split: 'train', evidence: { source_id: '2323.tiff' } })).toEqual({
        sourceId: '2323.tiff', sourceSplit: 'train', sourceSampleId: 'native-request', displayId: '2323.tiff'
    });
    expect(identity({ source_sample_id: 'native-request', original_record: { source_split: 'test', evidence: { source_id: '106.tiff' } } })).toEqual({
        sourceId: '106.tiff', sourceSplit: 'test', sourceSampleId: 'native-request', displayId: '106.tiff'
    });
});

it('prefers explicit source IDs and preserves numeric zero and leading zeros', () => {
    expect(identity({ source_id: 0, evidence: { source_id: 'stale' } }).displayId).toBe('0');
    expect(identity({ source_id: '00106.tiff', original_record: { source_id: 'stale' } }).displayId).toBe('00106.tiff');
});

it('falls back safely without relabeling a generated request ID as a source ID', () => {
    const examples: JsonObject[] = [{}, { source_sample_id: 'native-generated-id' }, { source_id: [], evidence: null, original_record: [] }, { source_id: false, evidence: 'invalid', original_record: { evidence: { source_id: '   ' } } }];
    for (const metadata of examples) {
        expect(identity(metadata)).toMatchObject({ sourceId: undefined, displayId: 'internal-request' });
    }
});
