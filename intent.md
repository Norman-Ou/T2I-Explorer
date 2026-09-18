# T2I Explorer Web App Intent

## Purpose

Build a standalone web application for inspecting and comparing text-to-image evaluation results.
The interaction and visual structure should follow DiVE's T2I Explorer as closely as practical,
while changing the data model so each selected model owns its prompt data.

This application replaces the old GeoBanana results web app. It is a new product and data
contract, not a compatibility layer over GeoBanana's `viewer.json` schema.

## Product requirements

### Comparison layout

- The left sidebar can select multiple model/step pairs.
- Each selected model/step pair adds one column to the main viewer.
- Selected columns can be removed and reordered.
- Rows align only by `prompt_id`.
- A model may use a different `prompt` for the same `prompt_id` than another model.
- A model may omit a `prompt_id`; the aligned cell must render an explicit missing state rather
  than shifting later rows.
- Each model cell renders, in this order: `prompt`, `prompt_output`, then the generated image.

### Record details

- Clicking an image opens a lightbox with the enlarged image.
- A details panel on the right displays every field from that model's record for the selected
  `prompt_id`, including arbitrary additional JSON fields.
- Nested objects and arrays must remain inspectable; unknown fields must not be discarded.
- The selected record and model must remain unambiguous when several model columns are visible.

### Explorer behavior

- Provide DiVE-like eval-set selection, model selection, prompt search, pagination, deterministic
  shuffle, model-column reordering, and collapsible/resizable navigation.
- Preserve view state in the URL so a shared URL reconstructs the selected eval set, model/step
  columns, search, page, page size, ordering, and active view.
- Target the DiVE view modes: Gallery, Steps, Models, and Table. The first implementation milestone
  prioritizes Models because it exercises the new per-model record contract.
- Search must cover `prompt_id`, `prompt`, and `prompt_output`. Filtering, sorting, grouping, and
  selectable extra fields should follow once the core comparison and lightbox behavior is stable.
- Data reload must pick up added eval sets, models, steps, JSON records, and images without a code
  change.

## Data contract draft

All user-supplied JSON and images live under `data/eval-sets/`, separate from application source.
The initial on-disk layout is:

```text
data/eval-sets/
└── {eval_set}/
    ├── manifest.json
    └── models/
        └── {model_name}/
            ├── README.md                 # optional model description
            └── s{step}/
                ├── set.json
                └── p{prompt_id}.webp     # PNG/JPEG support may also be provided
```

`manifest.json` describes the eval set and discoverable models/steps. Its exact schema will be
versioned before implementation.

Each `set.json` is an array owned by one model/step. A record has three required fields and may
contain any additional JSON fields:

```json
[
  {
    "prompt_id": 1,
    "prompt": "The prompt used by this model for row 1",
    "prompt_output": "The prompt emitted or transformed by this model",
    "seed": 42,
    "category": "example"
  }
]
```

Contract rules:

- `prompt_id` is an integer and is unique within one `set.json`.
- Cross-model joins use only `prompt_id`; neither `prompt` nor `prompt_output` participates in the
  join or equality validation.
- `prompt` and `prompt_output` are strings owned by the model/step record.
- Extra fields may be strings, numbers, booleans, nulls, arrays, or objects and are retained for
  the details panel.
- The default image path is `p{prompt_id}.webp`. A later versioned schema may add an explicit image
  field or multiple images without changing the meaning of the three required fields.
- The viewer uses the union of selected models' prompt IDs and shows missing cells explicitly.
- Invalid JSON, duplicate IDs, missing required fields, and missing image files are surfaced in the
  UI with actionable errors; they are never silently dropped.

## Replacement boundary

The standalone app lives at `/home/quruizhe/T2I-Explorer` and has its own Git history. Large local
evaluation images and set data are ignored by Git by default.

A later GeoBanana cleanup PR will remove the old results-webapp renderer, `viewer.json` contract,
and producer adapters, together with their dedicated launch/config/documentation entry points.
The cleanup must preserve unrelated evaluation and image-analysis utilities. In particular,
`compare_strip.py` is a standalone review-image generator rather than the web app itself; it should
be evaluated separately instead of being deleted merely because it currently lives under
`geobanana/viz/`.

There will be no dual-read adapter from GeoBanana `viewer.json` into the new app unless a concrete
dataset later proves that a one-time migration tool is necessary.

## Reference implementations

- DiVE User Guide, T2I Explorer section, read at revision 4514 on 2026-09-18.
- Live DiVE T2I Explorer behavior at
  `https://dive.ai.mewtant.co/t2i-explorer/ph-e2e-eval-0819-sfw`.
- `Norman-Ou/Text-to-Image-Explorer` at commit
  `f499cc331d3bb7a0c1004f228e509786140d030e`. Its Streamlit implementation is a behavioral
  reference; the new app is free to use a different frontend architecture to reach DiVE-level
  interaction quality.

## Delivery sequence

1. Freeze the versioned manifest and `set.json` schemas with representative fixtures.
2. Build model/step discovery and validation against the standalone data directory.
3. Implement the Models view, ID alignment, per-cell field order, missing cells, and lightbox
   details panel.
4. Add sidebar controls, URL state, search, pagination, shuffle, reorder, resize, and collapse.
5. Add Gallery, Steps, and Table views plus filtering, sorting, grouping, and field selection.
6. Validate behavior against mixed prompts, missing IDs, arbitrary nested fields, and multiple
   image formats.
7. Prepare the separate GeoBanana cleanup PR after the replacement covers the required workflows.

## Acceptance criteria

- Selecting a second model creates a second aligned column without a page reload.
- Two records with the same `prompt_id` and different `prompt` values render in the same row and
  retain their own text.
- Every populated cell shows `prompt`, then `prompt_output`, then its image.
- Clicking any image enlarges it and shows all fields for that exact model/step record on the right.
- Extra JSON fields require no frontend schema change to appear in the details panel.
- Missing IDs and malformed records are visible and diagnosable.
- A copied URL reconstructs the comparison state.
- The replacement does not depend on GeoBanana's old webapp modules or adapters.

## Current phase

Only the standalone repository, data directory, and intent are initialized. Application code,
framework selection, sample datasets, GeoBanana deletions, remotes, and pull requests are deferred
to the implementation phase.
