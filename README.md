# T2I Explorer

T2I Explorer is a standalone, local-first web application for comparing text-to-image evaluation results. Each selected model/step owns its records, and comparison rows align only by integer `prompt_id`.

The first release implements the Models view: multi-column selection and reorder, literal prompt search, pagination, deterministic shuffle, shareable URL state, explicit missing cells, image lightboxes, arbitrary nested JSON details, validation diagnostics, and data reload without a code rebuild.

## Requirements

- Node.js 24.21.0
- pnpm 12.4.2

Install dependencies and generate a production build:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://127.0.0.1:4173`. The server binds only to loopback by default and reads `data/eval-sets/`. Override the data directory with an absolute or repository-relative `T2I_DATA_ROOT`.

For client and server development, run these in separate terminals:

```bash
pnpm dev
pnpm dev:client
```

The Vite client is available at `http://127.0.0.1:5173` and proxies API calls to port 4173.

## Data contract

T2I Explorer discovers data from `T2I_DATA_ROOT` (default: `data/eval-sets/`). An evaluation set is
a direct child of that directory and is published only when it has a valid `manifest.json`.

```text
data/eval-sets/
└── {eval_set}/
    ├── manifest.json
    └── models/{model_id}/s{step}/
        ├── set.json
        └── p{prompt_id}.{webp,png,jpg,jpeg}
```

The directory names are part of the contract:

- `{eval_set}` must exactly equal `manifest.json`'s `id`.
- `{model_id}` must exactly equal a model `id` declared in the manifest.
- `{step}` is a non-negative integer declared in that model's `steps` array. Its directory is named
  `s{step}`, for example `s1000`.
- `set.json` contains the records owned by that exact model/step pair.
- An optional generated image is named `p{prompt_id}` plus a supported lowercase extension.

The normative machine-readable definitions are
[`schemas/manifest-v1.schema.json`](schemas/manifest-v1.schema.json) and
[`schemas/record-v1.schema.json`](schemas/record-v1.schema.json). The following instructions explain
the currently supported version 1 contract.

### Add a new evaluation dataset

1. Create a directory directly below the data root, for example
   `data/eval-sets/my-eval/`.
2. Add `manifest.json`. It must declare every model and step that should be selectable.
3. For every declared model/step pair, create `models/{model_id}/s{step}/set.json`.
4. Add zero or one image per record using the required image naming convention.
5. Start the application, or click **Reload data** if it is already running. Manifest changes are
   also discovered automatically on a subsequent request.

Minimal example:

```text
data/eval-sets/my-eval/
├── manifest.json
└── models/
    └── flux-dev/
        └── s0/
            ├── set.json
            ├── p1.webp
            └── p2.png
```

```json
{
  "schema_version": 1,
  "record_schema_version": 1,
  "id": "my-eval",
  "title": "My evaluation set",
  "description": "Optional human-readable context.",
  "models": [
    {
      "id": "flux-dev",
      "label": "FLUX.1-dev",
      "steps": [0]
    }
  ]
}
```

Required manifest fields are:

| Location | Field | Requirement |
|---|---|---|
| manifest | `schema_version` | Required; must be `1`. |
| manifest | `record_schema_version` | Required; must be `1`. |
| manifest | `id` | Required; must equal the evaluation-set directory name. |
| manifest | `title` | Required, non-empty display name. |
| manifest | `models` | Required array of model declarations. |
| model | `id` | Required; must equal its directory name and be unique in this manifest. |
| model | `label` | Required, non-empty display name. |
| model | `steps` | Required non-empty array of unique, non-negative integer steps. |

`description` is optional at both manifest and model level. IDs must be 1–64 characters, begin with
an ASCII letter or digit, and otherwise contain only ASCII letters, digits, `.`, `_`, or `-`.
Unknown fields are not allowed in the manifest or its model declarations.

### Add a model or step to an existing dataset

To add a model, add one model object to the existing manifest's `models` array, then create one
`models/{model_id}/s{step}/set.json` directory for each declared step. For example:

```json
{
  "id": "sdxl-base",
  "label": "SDXL Base",
  "description": "Optional model notes.",
  "steps": [1000, 2000]
}
```

```text
my-eval/models/sdxl-base/
├── s1000/
│   ├── set.json
│   └── p1.webp
└── s2000/
    ├── set.json
    └── p1.webp
```

To add a new step to an existing model, append the integer to that model's `steps` array and create
the matching `s{step}/set.json` directory. A directory that is not declared in the manifest is not
discoverable. Conversely, a declared model/step without a valid `set.json` remains selectable but
loads as an error.

Model/step datasets are independent. They do not need identical prompts or identical sets of IDs.
The comparison grid takes the union of their `prompt_id` values and aligns cells solely by exact
numeric `prompt_id`; it never aligns or copies data by prompt text.

### Model record schema (`set.json`)

Each `set.json` must be a JSON array. Every array element represents one prompt result for that
model/step and has three required fields:

```json
[
  {
    "prompt_id": 1,
    "prompt": "A lighthouse beside a calm sea",
    "prompt_output": "A white lighthouse at dusk, cinematic lighting",
    "seed": 42,
    "scores": {
      "alignment": 0.91,
      "aesthetic": 0.72
    },
    "tags": ["coastal", "night"]
  }
]
```

| Field | Required | Type and meaning |
|---|---:|---|
| `prompt_id` | Yes | Non-negative JSON integer up to `9007199254740991`. It must be unique within this `set.json` and is the only cross-model alignment key. |
| `prompt` | Yes | JSON string containing this model record's source prompt. An empty string is valid. |
| `prompt_output` | Yes | JSON string containing the actual prompt/instruction submitted for generation. An empty string is valid. |
| Any other non-empty key | No | Any JSON value. Extra metadata is retained and displayed verbatim in the details inspector. |

The three required fields belong to each model record; they are not inherited from another model.
A duplicate `prompt_id` makes the entire model/step dataset ambiguous and it will not load. Other
invalid records are omitted from comparison and reported in the UI diagnostics.

### Images: optional but convention-based

For a record with `"prompt_id": 17`, place at most one of these files beside `set.json`:

```text
p17.webp
p17.png
p17.jpg
p17.jpeg
```

An image is optional: a record without one remains usable and displays an explicit missing-image
state. If multiple formats exist for the same ID, the first in the order WebP, PNG, JPG, JPEG is
shown and the dataset receives an ambiguity warning. The extension and actual file signature must
agree; supported media types are WebP, PNG, and JPEG. Image paths are derived from `prompt_id`—an
image path or URL field in `set.json` is treated only as extra metadata and is not loaded.

### What is strictly necessary?

For one usable selectable model/step, all of the following are necessary:

- a valid evaluation-set directory and `manifest.json`;
- manifest versions, evaluation-set `id`, `title`, and a model declaration;
- model `id`, `label`, and at least one declared step;
- the matching `models/{model_id}/s{step}/set.json` JSON array;
- `prompt_id`, `prompt`, and `prompt_output` with the correct types in every usable record; and
- unique `prompt_id` values within each `set.json`.

Images, descriptions, and record metadata are optional. Different models may omit records that
other models contain. The application shows those gaps explicitly.

Operational limits protect local machines from malformed or unexpectedly large input: at most 100
evaluation sets, 200 models and 1,000 model/step pairs per manifest, 100,000 records or 100 MiB per
`set.json`, 1 MiB per record, and 50 MiB per image. Symlinks are rejected throughout the data tree.

The committed `fixtures/eval-sets/` tree is a development example. Large or machine-specific real data remains ignored under `data/eval-sets/`.

## Validation and tests

```bash
pnpm check
pnpm test:e2e
pnpm audit --prod --audit-level high
```

The test suite covers schema and resource validation, model-owned alignment, URL reconstruction, shuffle golden vectors, nested JSON safety, missing and ambiguous images, stale snapshot behavior, symlink rejection, keyboard operation, and automated accessibility checks.

## Deployment and security

The application is read-only. Dataset JSON and images are untrusted input: paths are resolved from validated manifest tuples, symlinks are rejected, image signatures are checked, resources are bounded, and record values are rendered only as text. API responses never expose absolute filesystem paths. Telemetry is disabled.

The CSP allows computed style attributes only for pane resizing and drag positioning. Scripts and style sheets remain same-origin, and dataset content is never used to construct styles. This local-only exception is recorded in the specification and must be reviewed before network deployment.

Non-loopback binding is refused unless `T2I_ALLOW_NETWORK=true` is explicitly set and `T2I_ALLOWED_HOSTS` contains a comma-separated host allowlist. That mode must be placed behind an authenticated TLS reverse proxy; the application does not provide authentication. Prompts, identifiers, and search queries may be sensitive, and share URLs expose evaluation/model IDs and the current search through browser history.

See [spec.md](spec.md) for the full requirements, accepted limitations, and future milestones.

## Known release validation gap

Automated axe, keyboard, Chromium, Firefox, and Playwright WebKit checks are included. Real VoiceOver/Safari and NVDA or JAWS/Chrome testing, organization-specific brand approval, and organization-specific security/privacy sign-off require external environments and owners. They are not represented as completed by the engineering test suite.
