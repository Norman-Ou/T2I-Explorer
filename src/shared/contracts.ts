export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ManifestV1 = {
  schema_version: 1;
  record_schema_version: 1;
  id: string;
  title: string;
  description?: string;
  models: Array<{
    id: string;
    label: string;
    description?: string;
    steps: number[];
  }>;
};

export type RecordV1 = {
  prompt_id: number;
  prompt: string;
  prompt_output: string;
  [key: string]: JsonValue;
};

export const diagnosticCodes = [
  "MANIFEST_INVALID",
  "UNSUPPORTED_SCHEMA_VERSION",
  "SET_JSON_INVALID",
  "RECORD_INVALID",
  "DUPLICATE_PROMPT_ID",
  "IMAGE_MISSING",
  "IMAGE_AMBIGUOUS",
  "IMAGE_DECODE_FAILED",
  "STALE_SNAPSHOT",
  "RESOURCE_LIMIT_EXCEEDED"
] as const;

export type DiagnosticCode = (typeof diagnosticCodes)[number];

export type Diagnostic = {
  severity: "warning" | "error";
  code: DiagnosticCode;
  message: string;
  eval_set_id?: string;
  model_id?: string;
  step?: number;
  public_path?: string;
  record_index?: number;
  prompt_id?: number;
};

export type CatalogResponse = {
  snapshot_id: string;
  eval_sets: Array<{
    id: string;
    title: string;
    description?: string;
    record_schema_version: 1;
    models: ManifestV1["models"];
  }>;
  diagnostics: Diagnostic[];
};

export type ImageDescriptor = {
  status: "available" | "missing" | "ambiguous" | "invalid";
  url?: string;
  media_type?: "image/webp" | "image/png" | "image/jpeg";
  file_name?: string;
  width?: number;
  height?: number;
};

export type DatasetResponse = {
  eval_set_id: string;
  model_id: string;
  step: number;
  snapshot_id: string;
  records: RecordV1[];
  images: Record<string, ImageDescriptor>;
  diagnostics: Diagnostic[];
};

export type ApiError = {
  error: { code: string; message: string; request_id: string };
};

export const idPattern = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";

export const manifestSchema = {
  $id: "t2i-explorer/manifest-v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "record_schema_version", "id", "title", "models"],
  properties: {
    schema_version: { const: 1 },
    record_schema_version: { const: 1 },
    id: { type: "string", pattern: idPattern },
    title: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    models: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "steps"],
        properties: {
          id: { type: "string", pattern: idPattern },
          label: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", maxLength: 2000 },
          steps: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "integer", minimum: 0, maximum: 2147483647 }
          }
        }
      }
    }
  }
} as const;

export const recordSchema = {
  type: "object",
  propertyNames: { minLength: 1 },
  required: ["prompt_id", "prompt", "prompt_output"],
  properties: {
    prompt_id: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER
    },
    prompt: { type: "string" },
    prompt_output: { type: "string" }
  },
  additionalProperties: true
} as const;
