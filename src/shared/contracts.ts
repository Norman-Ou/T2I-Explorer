export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export type DataOrigin = 'native' | 'derived';
export type ExperimentManifest = {
    schema_version: 3;
    id: string;
    title: string;
    description?: string;
    record_count: number;
    metadata: JsonObject;
};
export type Experiment = Omit<ExperimentManifest, 'schema_version'>;
export type SourceDataset = {
    id: string;
    title: string;
    data_origin: DataOrigin;
    exps: Experiment[];
};
export type Task = {
    id: string;
    title: string;
    datasets: SourceDataset[];
};
export type Collection = {
    id: string;
    title: string;
    description?: string;
    tasks: Task[];
};
export type CollectionManifest = Omit<Collection, 'tasks'> & {
    schema_version: 3;
    tasks: Array<Omit<Task, 'datasets'> & {
        datasets: Array<Omit<SourceDataset, 'exps'> & {
            exps: Array<{
                id: string;
            }>;
        }>;
    }>;
};
export type Panel = {
    id: string;
    title: string;
    asset: string | null;
    unavailable_reason?: string;
};
export type SampleRecord = {
    sample_id: string;
    index: number;
    input_text: string | null;
    pred_text: string | null;
    gt_text: string | null;
    panels: Panel[];
    extra_texts?: Array<{
        title: string;
        text: string | null;
    }>;
    metadata: JsonObject;
};
export type PanelView = Omit<Panel, 'asset'> & {
    status: 'available' | 'missing' | 'invalid';
    url?: string;
    thumbnail_url?: string;
    media_type?: string;
    width?: number;
    height?: number;
};
export type SampleView = Omit<SampleRecord, 'panels'> & {
    panels: PanelView[];
};
export type Diagnostic = {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    collection_id?: string;
};
export type CatalogResponse = {
    snapshot_id: string;
    collections: Collection[];
    diagnostics: Diagnostic[];
};
export type ExperimentResponse = {
    collection_id: string;
    task_id: string;
    dataset_id: string;
    exp_id: string;
    snapshot_id: string;
    records: SampleView[];
    diagnostics: Diagnostic[];
};
export type ApiError = {
    error: {
        code: string;
        message: string;
        request_id: string;
    };
};
export const idPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const id = { type: 'string', pattern: idPattern };
const title = { type: 'string', minLength: 1, maxLength: 160 };
const text = { type: ['string', 'null'] };
export const collectionSchema = {
    $id: 't2i-explorer/collection', type: 'object', additionalProperties: false, required: ['schema_version', 'id', 'title', 'tasks'],
    properties: { schema_version: { const: 3 }, id, title, description: { type: 'string', maxLength: 4000 }, tasks: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'datasets'], properties: { id, title, datasets: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'data_origin', 'exps'], properties: { id, title, data_origin: { enum: ['native', 'derived'] }, exps: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['id'], properties: { id } } } } } } } } } }
} as const;
export const experimentSchema = { $id: 't2i-explorer/experiment', type: 'object', additionalProperties: false, required: ['schema_version', 'id', 'title', 'record_count', 'metadata'], properties: { schema_version: { const: 3 }, id, title, description: { type: 'string', maxLength: 4000 }, record_count: { type: 'integer', minimum: 0, maximum: 100000 }, metadata: { type: 'object' } } } as const;
export const sampleSchema = { $id: 't2i-explorer/sample', type: 'object', additionalProperties: false, required: ['sample_id', 'index', 'input_text', 'pred_text', 'gt_text', 'panels', 'metadata'], properties: { sample_id: id, index: { type: 'integer', minimum: 1, maximum: 2147483647 }, input_text: text, pred_text: text, gt_text: text, panels: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'asset'], properties: { id, title, asset: { type: ['string', 'null'], pattern: '^assets/[A-Za-z0-9._/-]+$' }, unavailable_reason: { type: 'string', minLength: 1, maxLength: 2000 } }, allOf: [{ if: { properties: { asset: { type: 'null' } } }, then: { required: ['unavailable_reason'], properties: { unavailable_reason: { type: 'string' } } } }] } }, extra_texts: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title, text } } }, metadata: { type: 'object' } } } as const;
