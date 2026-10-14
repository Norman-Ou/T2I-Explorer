import type { JsonObject, JsonValue, SampleRecord } from './contracts.js';

function object(value: JsonValue | undefined): JsonObject | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function identifier(value: JsonValue | undefined): string | undefined {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
}

// Published packages retain provenance either directly or in original_record.
// Source IDs describe the source record; sample_id still identifies each request.
export function sampleIdentity(record: Pick<SampleRecord, 'sample_id' | 'metadata'>) {
    const metadata = record.metadata;
    const original = object(metadata.original_record);
    const sources = [metadata, object(metadata.evidence), original, object(original?.evidence)];
    const first = (key: string) => sources.map(source => identifier(source?.[key])).find(value => value !== undefined);
    const sourceId = first('source_id');
    return {
        sourceId,
        sourceSplit: first('source_split'),
        sourceSampleId: first('source_sample_id'),
        displayId: sourceId ?? record.sample_id
    };
}
