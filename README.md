# T2I Explorer

T2I Explorer is a local, read-only browser for task and source review examples. Its v2 contract
uses named steps and an independently published dataset root. A plain URL opens a searchable
dataset chooser. A dataset can be browsed in Gallery, Steps, or Models mode; repeated columns are
independent and comparison rows align by R30 ordinal, never by shared source identity.

## Run

Requires Node.js 24.21.0 and pnpm 12.4.2.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://127.0.0.1:4173`. The default root is `data/datasets/`; set `T2I_DATA_ROOT` to an
absolute or repository-relative directory to publish data without changing this repository.
For a synthetic example, run `T2I_DATA_ROOT=fixtures/datasets pnpm start`. This fixture has no
real GeoBanana data. Newly published manifests are discovered on the next request or with Reload.

## v2 data contract

```text
data/datasets/{dataset_id}/manifest.json
data/datasets/{dataset_id}/{model_id}/{step_id}/set.json
data/datasets/{dataset_id}/{model_id}/{step_id}/sample-{sample_index}.png
```

Supported image formats are PNG, WebP, JPEG. IDs match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. The manifest explicitly declares models and named steps:

```json
{
  "schema_version": 2,
  "record_schema_version": 2,
  "id": "sft-e6.0-r30",
  "title": "sft-e6.0-r30",
  "models": [{ "id": "refseg", "label": "RefSeg", "steps": [{
    "id": "sior-t", "label": "SIOR_T", "review_stage": "accepted_e6_sft_row",
    "status": "partial", "record_count": 2, "target_count": 30,
    "shortfall_reason": "Only two examples published"
  }] }]
}
```

A complete pair has 30 records. An incomplete pair needs its actual count and shortfall reason;
a blocked pair has zero records and an empty `set.json` array. The allowed review stages are
`accepted_e6_sft_row`, `official_training_execution`, `official_preview_loader_execution`,
`official_method_extension`, `paper_example`, and `source_annotation_audit`. A published-preview
loader execution or paper example is separate from verified original-source training evidence. The server
checks declared counts against `set.json` and rejects invalid or duplicate sample indices.

Each record has `sample_index` (contiguous 1..N), `source_sample_id`, `review_stage`, exact
`message_input_text` and `message_output_text`, `source_annotation_text`, `source_dataset`,
`source_split`, `source_manifest_path`, three `panel_roles`, `asset_paths`, and `evidence`.
Text fields accept `null` for unavailable; `""` is an exact empty string. The composite
Paper examples can carry `paper_input_text` and `paper_output_text` separately from constructed
Message text. They have no train-split or training-target claim. The composite
`sample-{sample_index}` is a review image, not a training input. Provenance asset paths are
metadata only: the server never serves arbitrary paths from a record.

The public read-only routes are `GET /api/v2/catalog`,
`GET /api/v2/datasets/{dataset_id}/{model_id}/{step_id}`, and
`GET /api/v2/images/{dataset_id}/{model_id}/{step_id}/{sample_index}`. Reload is
`POST /api/v2/reload`. Machine-readable schemas are
[manifest v2](schemas/manifest-v2.schema.json) and [record v2](schemas/record-v2.schema.json).
The old integer-step v1 contract is retired; its [historical specification](spec.md) remains
for provenance. The current [v2 specification](spec-r30-v2.md) describes behavior and checks.

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --prod --audit-level high
```

The server rejects symlinks/path escape, validates image signatures and dimensions, bounds JSON
and image sizes, renders data as text, and binds to loopback by default. Network binding requires
`T2I_ALLOW_NETWORK=true`, an allowed host list, and an authenticated TLS reverse proxy.
Each v2 record remains bounded to 1 MiB, 25,000 JSON nodes, and depth 100; this permits
the portable BaseModel archive's exact per-example evidence to stay in the detail JSON.
