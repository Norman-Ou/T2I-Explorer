export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const reviewStages = ["accepted_e6_sft_row", "official_training_execution", "official_preview_loader_execution", "official_method_extension", "paper_example", "source_annotation_audit"] as const;
export type ReviewStage = (typeof reviewStages)[number];
export type PairStatus = "complete" | "partial" | "blocked";
export type StepV2 = {
  id: string;
  label: string;
  review_stage: ReviewStage;
  status: PairStatus;
  record_count: number;
  target_count: number;
  shortfall_reason?: string;
};
export type ModelV2 = { id: string; label: string; description?: string; steps: StepV2[] };
export type ManifestV2 = { schema_version: 2; record_schema_version: 2; id: string; title: string; description?: string; models: ModelV2[] };
export type RecordV2 = {
  sample_index: number;
  source_sample_id: string;
  review_stage: ReviewStage;
  message_input_text: string | null;
  message_output_text: string | null;
  source_annotation_text: string | null;
  paper_input_text?: string | null;
  paper_output_text?: string | null;
  source_dataset: string;
  source_split: string;
  source_manifest_path: string | null;
  panel_roles: [string, string, string];
  asset_paths: { [key: string]: string[] };
  evidence: { [key: string]: JsonValue };
  [key: string]: JsonValue | undefined;
};
export const diagnosticCodes = ["MANIFEST_INVALID", "UNSUPPORTED_SCHEMA_VERSION", "SET_JSON_INVALID", "RECORD_INVALID", "DUPLICATE_SAMPLE_INDEX", "COUNT_MISMATCH", "IMAGE_MISSING", "IMAGE_AMBIGUOUS", "IMAGE_DECODE_FAILED", "STALE_SNAPSHOT", "RESOURCE_LIMIT_EXCEEDED"] as const;
export type DiagnosticCode = (typeof diagnosticCodes)[number];
export type Diagnostic = { severity: "warning" | "error"; code: DiagnosticCode; message: string; dataset_id?: string; model_id?: string; step_id?: string; public_path?: string; record_index?: number; sample_index?: number };
export type CatalogResponse = { snapshot_id: string; datasets: Array<{ id: string; title: string; description?: string; record_schema_version: 2; models: ModelV2[] }>; diagnostics: Diagnostic[] };
export type ImageDescriptor = { status: "available" | "missing" | "ambiguous" | "invalid"; url?: string; media_type?: "image/webp" | "image/png" | "image/jpeg"; file_name?: string; width?: number; height?: number };
export type DatasetResponse = { dataset_id: string; model_id: string; step_id: string; snapshot_id: string; records: RecordV2[]; images: Record<string, ImageDescriptor>; diagnostics: Diagnostic[] };
export type ApiError = { error: { code: string; message: string; request_id: string } };
export const idPattern = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";
const id = { type: "string", pattern: idPattern } as const;
const stage = { enum: reviewStages } as const;
export const manifestSchema = {
  $id: "t2i-explorer/manifest-v2", type: "object", additionalProperties: false,
  required: ["schema_version", "record_schema_version", "id", "title", "models"],
  properties: {
    schema_version: { const: 2 }, record_schema_version: { const: 2 }, id,
    title: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 2000 },
    models: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false,
      required: ["id", "label", "steps"], properties: { id, label: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 2000 },
        steps: { type: "array", maxItems: 1000, items: { type: "object", additionalProperties: false,
          required: ["id", "label", "review_stage", "status", "record_count", "target_count"],
          properties: { id, label: { type: "string", minLength: 1, maxLength: 120 }, review_stage: stage,
            status: { enum: ["complete", "partial", "blocked"] }, record_count: { type: "integer", minimum: 0, maximum: 30 },
            target_count: { const: 30 }, shortfall_reason: { type: "string", minLength: 1, maxLength: 2000 } }
        } }
      } }
    }
  }
} as const;
export const recordSchema = {
  $id: "t2i-explorer/record-v2", type: "object", additionalProperties: true,
  required: ["sample_index", "source_sample_id", "review_stage", "message_input_text", "message_output_text", "source_annotation_text", "source_dataset", "source_split", "source_manifest_path", "panel_roles", "asset_paths", "evidence"],
  properties: {
    sample_index: { type: "integer", minimum: 1, maximum: 30 },
    source_sample_id: { type: "string", minLength: 1, maxLength: 1000 }, review_stage: stage,
    message_input_text: { type: ["string", "null"] }, message_output_text: { type: ["string", "null"] },
    source_annotation_text: { type: ["string", "null"] }, source_dataset: { type: "string", minLength: 1 },
    paper_input_text: { type: ["string", "null"] }, paper_output_text: { type: ["string", "null"] },
    source_split: { type: "string", minLength: 1 }, source_manifest_path: { type: ["string", "null"] },
    panel_roles: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
    asset_paths: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
    evidence: { type: "object" }
  }
} as const;
