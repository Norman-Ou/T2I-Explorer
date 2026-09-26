# T2I Explorer Requirements and Design Specification

Status: historical v1 milestone; current v2 authority is [spec-r30-v2.md](spec-r30-v2.md). External release sign-offs remain pending
Source of truth: `intent.md` at commit `3f40258`  
Prepared: 2026-09-18  
Initial release target: Models view (Milestone 1)

## 1. Executive summary

T2I Explorer is a new, standalone web application for inspecting and comparing text-to-image evaluation results stored under `data/eval-sets/`. It replaces the GeoBanana results viewer but does not read GeoBanana's `viewer.json`, import GeoBanana web-app code, or require GeoBanana at runtime.

The first milestone provides a Models view in which each selected model/step pair is a column and rows are the union of those columns' integer `prompt_id` values. Records with the same ID align even when their prompts differ. Missing records stay visibly missing. Every populated cell shows its own `prompt`, `prompt_output`, and image in that order. Selecting an image opens an accessible lightbox and an unambiguous details panel containing the complete record, including recursively inspectable unknown fields.

The recommended implementation is a TypeScript monorepo-style application with a React client and a small Node.js HTTP server. The server owns filesystem discovery, validation, safe image serving, and reload behavior; the browser owns view state, comparison layout, and interaction. This split avoids exposing local paths to the browser and permits datasets to change without rebuilding application code.

## 2. Scope

### 2.1 Milestone 1: required

- Discover versioned evaluation-set manifests beneath `data/eval-sets/`.
- Discover and validate the model/step datasets declared by each manifest.
- Select one evaluation set and multiple model/step columns.
- Add, remove, and reorder columns without a page reload.
- Align rows by the union of selected columns' `prompt_id` values.
- Render each populated cell in the fixed order `prompt`, `prompt_output`, image.
- Render an explicit missing-record cell when a selected column lacks a row ID.
- Search `prompt_id`, `prompt`, and `prompt_output` across selected columns.
- Paginate and deterministically shuffle aligned rows.
- Open an image in a lightbox with a details panel for exactly that record and column.
- Preserve all JSON fields and render nested arrays and objects safely.
- Preserve shareable view state in the URL.
- Provide collapsible, keyboard-accessible navigation and user-resizable navigation/details regions.
- Surface manifest, dataset, record, and image diagnostics without silently dropping data.
- Detect filesystem changes through explicit reload and server-side change detection without a code rebuild.
- Include representative fixtures and automated tests for the contract and core interactions.

### 2.2 Later milestones

- Gallery, Steps, and Table views.
- Typed filtering, sorting, grouping, and user-selectable extra fields.
- Explicit or multiple images per record through a future schema version.
- A one-time GeoBanana migration utility, only if a concrete dataset requires one.
- The separate GeoBanana cleanup pull request.

Later-view URL values may be recognized before those views ship, but the application must fall back to Models with a visible notice rather than showing a blank or broken view.

### 2.3 Explicitly out of scope

- Editing evaluation records, images, or manifests in the application.
- Generating images or running evaluations.
- Authentication, multi-user collaboration, annotations, or remote dataset storage in Milestone 1.
- A compatibility adapter for `viewer.json`.
- Deleting or changing GeoBanana code, including `compare_strip.py`.
- Uploading arbitrary datasets through the browser.

## 3. Users and primary workflows

The primary user is an evaluation researcher reviewing model output on a workstation or an access-controlled internal server.

### 3.1 Compare models

1. The user chooses an evaluation set.
2. The user chooses one or more model/step pairs.
3. Each pair appears as a comparison column.
4. The user searches, changes page size, shuffles, reorders, or removes columns.
5. Rows remain aligned by `prompt_id`, with gaps represented explicitly.

### 3.2 Inspect a record

1. The user activates a generated image with pointer or keyboard.
2. A modal lightbox opens on the image; the adjacent details panel identifies evaluation set, model, step, and `prompt_id`.
3. Every record field is visible. Objects and arrays can be expanded recursively.
4. The user moves to the previous or next available image in the current filtered ordering or closes the modal and returns focus to the originating image.

### 3.3 Share a view

1. The user copies the current browser URL.
2. A recipient with access to the same application and filesystem opens it.
3. The app reconstructs the evaluation set, ordered columns, query, pagination, ordering, and active view.
4. Invalid or no-longer-available values are reported and safely omitted or defaulted.

## 4. Functional requirements

Requirements use RFC 2119 meanings for MUST, SHOULD, and MAY.

### 4.1 Discovery and loading

- **FR-001** The server MUST use a configurable data root whose default is `<repository>/data/eval-sets`.
- **FR-002** An evaluation set is a direct child directory containing `manifest.json`. Unrelated files and hidden directories MUST be ignored.
- **FR-003** Only model/step pairs declared in a valid manifest are selectable. Adding a directory alone does not publish it; adding or updating the manifest and referenced files does, without an application code change.
- **FR-004** The server MUST provide an explicit reload operation. It SHOULD also detect manifest and `set.json` changes by file metadata on the next request. Correctness MUST NOT depend solely on filesystem watcher events.
- **FR-005** Reload MUST be atomic per evaluation set: readers receive either the last valid snapshot or the new valid snapshot, never a partially built snapshot. If a changed snapshot is invalid, the last valid snapshot MAY remain readable but the UI MUST prominently report that it is stale and show the new diagnostics.
- **FR-006** Image content MUST be read on request so replacing an image is visible after reload. HTTP validators SHOULD prevent needless transfer.

### 4.2 Selection and alignment

- **FR-010** A column identity is the tuple `(eval_set_id, model_id, step)`; duplicate tuples MUST NOT be added.
- **FR-011** Changing the evaluation set MUST clear model columns, active record, search, and page unless a future explicit cross-set mapping is defined.
- **FR-012** Rows MUST be the mathematical union of integer `prompt_id` values in all selected valid datasets.
- **FR-013** A cell lookup MUST use only exact numeric `prompt_id` equality. `prompt` and `prompt_output` MUST NOT affect alignment or be checked for cross-model equality.
- **FR-014** Each populated cell MUST show its own `prompt`, then `prompt_output`, then image. Text MUST not be substituted from another model.
- **FR-015** If a selected dataset does not contain the row ID, the cell MUST show a labeled “No record for prompt ID {id}” state and MUST occupy its normal grid position.
- **FR-016** A selected dataset with fatal file-level errors MUST retain its column and show a column-level error with diagnostic details; it MUST NOT disappear silently.
- **FR-017** Columns MUST support add, remove, drag reorder, and keyboard reorder. Reordering MUST update the URL and MUST not change row ordering.
- **FR-018** With no selected columns, the main region MUST show an actionable empty state and no rows.

### 4.3 Search, ordering, and pagination

- **FR-020** Processing order MUST be: align union -> search filter -> order/shuffle -> paginate.
- **FR-021** Search MUST be case-insensitive Unicode text matching over the decimal rendering of `prompt_id`, `prompt`, and `prompt_output` for every populated cell in the row. A row matches if any selected column matches any of those fields.
- **FR-022** Search MUST treat user input as literal text, not a regular expression. Leading and trailing whitespace SHOULD be trimmed; internal whitespace MUST be preserved.
- **FR-023** The default row order MUST be ascending numeric `prompt_id`.
- **FR-024** Shuffle MUST be deterministic across supported browsers and server restarts. Define it as sorting rows by ascending `xmur3("t2i-explorer:v1:" + seed + ":" + prompt_id)` unsigned 32-bit result, then ascending `prompt_id` as a collision tie-breaker. The seed is an unsigned 32-bit decimal integer.
- **FR-025** Invoking Shuffle MUST generate a new seed using `crypto.getRandomValues`, set ordering to `shuffle`, reset the page to 1, and store the seed in the URL. Reloading the URL MUST reproduce the order.
- **FR-026** Changing search, selected columns, page size, or ordering MUST reset the page to 1. Column reorder MUST preserve the page when it remains valid.
- **FR-027** Supported page sizes for Milestone 1 MUST be 10, 25, 50, and 100, defaulting to 25.
- **FR-028** If data changes make the requested page exceed the last page, the app MUST select the last valid page and replace the URL with its canonical value.

The normative xmur3 operation in FR-024 is the following JavaScript-equivalent algorithm. Input is processed as UTF-16 code units, `Math.imul` is signed 32-bit multiplication, bit operations are 32-bit, and the final `>>> 0` converts the result to an unsigned integer:

```ts
function rowHash(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
```

Shared contract tests MUST include fixed input/output vectors generated from this exact function; implementations in other languages must reproduce its 32-bit overflow behavior.

### 4.4 Images and record details

- **FR-030** For schema version 1, image candidates are `p{prompt_id}.webp`, `.png`, `.jpg`, and `.jpeg`, in that precedence order.
- **FR-031** No candidate is a record-level error. More than one candidate is a warning; the first by precedence is displayed and the alternatives are listed in diagnostics.
- **FR-032** Images MUST use intrinsic dimensions when available, preserve aspect ratio, lazy-load outside the initial viewport, and provide an explicit loading and decode-failure state.
- **FR-033** Image alternative text MUST be `Generated image for prompt ID {id}, {model label}, step {step}`. The adjacent visible text already contains the prompt and need not be duplicated into alt text.
- **FR-034** Activating an available image MUST open a modal lightbox for the exact tuple `(eval set, model, step, prompt_id)` and update the URL active-record state.
- **FR-035** The lightbox header and details panel MUST continuously display model label, step, and prompt ID. Model color alone MUST NOT convey identity.
- **FR-036** The details panel MUST expose every key/value pair from the original record, including the three required fields and all unknown fields. Property order SHOULD preserve source JSON order.
- **FR-037** Nested objects and arrays MUST be recursively expandable. Scalar values MUST show their JSON type. Long strings MUST wrap and offer copy; `null` MUST be visibly distinct from a missing field.
- **FR-038** Record content MUST be rendered as inert text. It MUST never be interpreted as HTML, Markdown, a script, or an executable URL.
- **FR-039** Escape closes the lightbox, focus remains trapped while open, and close returns focus to the triggering image. Previous/next navigation MUST skip missing or broken images and follow the current filtered row and column order.
- **FR-040** Closing the lightbox MUST clear only active-record URL state. If active-record state references missing data, the normal view loads and shows a dismissible warning.

### 4.5 Navigation and responsive behavior

- **FR-050** The left navigation MUST contain evaluation-set selection, model/step selection, search, ordering controls, page-size control, reload, and validation status.
- **FR-051** The navigation MUST collapse and expand, and be pointer-resizable on desktop. Its width MUST be keyboard adjustable in 16 px increments and constrained to 240–480 px. Collapsed state MUST retain a labeled expand control.
- **FR-052** The lightbox details panel MUST be resizable from 320 px to 50% of the viewport on desktop. On narrow screens it MUST become a full-width region below the image.
- **FR-053** User interface chrome MUST remain usable at 320 CSS px width and at 200% browser zoom. The comparison canvas MAY horizontally scroll; headers SHOULD remain sticky.
- **FR-054** Resize widths MAY be kept in local storage because they are device preferences; reconstructable comparison state MUST remain in the URL.

### 4.6 Diagnostics

- **FR-060** Diagnostics MUST include severity, stable code, human-readable message, evaluation set, model/step where applicable, filename, and record index or prompt ID where applicable.
- **FR-061** Fatal manifest or `set.json` syntax/shape errors MUST prevent that manifest or dataset snapshot from becoming active. Record-level errors MUST remain visible and addressable by source array index.
- **FR-062** Invalid records MUST NOT participate in aligned rows because they lack a trustworthy contract, but MUST appear in the diagnostics summary and detail list. This is not silent dropping.
- **FR-063** Duplicate `prompt_id` values make the entire `set.json` invalid because choosing one would be ambiguous.
- **FR-064** The UI MUST show counts by severity and provide an expandable diagnostics list. Error messages MUST suggest the expected path or field without exposing absolute server filesystem paths.
- **FR-065** Expected stable diagnostic codes include `MANIFEST_INVALID`, `UNSUPPORTED_SCHEMA_VERSION`, `SET_JSON_INVALID`, `RECORD_INVALID`, `DUPLICATE_PROMPT_ID`, `IMAGE_MISSING`, `IMAGE_AMBIGUOUS`, `IMAGE_DECODE_FAILED`, and `STALE_SNAPSHOT`.

## 5. Version 1 data contract

All files are UTF-8. JSON files MUST contain strict JSON, not JSON5. Unknown manifest properties MUST be rejected to catch misspellings; unknown record properties MUST be preserved.

### 5.1 Path safety and identifiers

- `eval_set_id` is the directory name and MUST match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- `model_id` MUST match the same expression and names its directory under `models/`.
- `step` is an integer from 0 through 2,147,483,647 and maps to directory `s{step}`.
- `prompt_id` is an integer from 0 through 9,007,199,254,740,991 (JavaScript's safe integer range).
- IDs are case-sensitive. Labels are for presentation only and MUST NOT be used to construct paths.
- Resolved files MUST remain under the configured data root. Symlinks anywhere in a resolved dataset or image path MUST be rejected. URL input MUST never be concatenated directly into a filesystem path.

### 5.2 `manifest.json`

Version 1 has this normative TypeScript shape:

```ts
type ManifestV1 = {
  schema_version: 1;
  record_schema_version: 1;
  id: string;                 // must equal the eval-set directory name
  title: string;              // 1..120 Unicode characters
  description?: string;       // 0..2000 Unicode characters
  models: Array<{
    id: string;               // unique within this manifest
    label: string;            // 1..120 Unicode characters
    description?: string;     // 0..2000 Unicode characters
    steps: number[];          // non-empty, unique; display in numeric ascending order
  }>;
};
```

Example:

```json
{
  "schema_version": 1,
  "record_schema_version": 1,
  "id": "sample-eval",
  "title": "Sample evaluation",
  "description": "A small contract fixture.",
  "models": [
    {
      "id": "model-a",
      "label": "Model A",
      "steps": [1000, 2000]
    }
  ]
}
```

The corresponding dataset is `models/model-a/s1000/set.json`. An optional `models/model-a/README.md` is discoverable metadata but is not rendered in Milestone 1; if later rendered, it must be sanitized and covered by a schema update or separate documented contract.

### 5.3 `set.json`

The manifest's `record_schema_version` versions every referenced `set.json`. Version 1 remains a top-level array:

```ts
type JsonValue = null | boolean | number | string | JsonValue[] |
  { [key: string]: JsonValue };

type RecordV1 = {
  prompt_id: number;          // safe, non-negative integer; unique in this file
  prompt: string;
  prompt_output: string;
  [additionalField: string]: JsonValue;
};

type SetV1 = RecordV1[];
```

Empty prompt strings are valid because they may be meaningful evaluation input. JSON numbers must be finite by the JSON grammar. Additional keys may use any non-empty JSON property name other than redefining the three required fields with an invalid type. The server MUST preserve values without coercion.

### 5.4 Resource limits

Defaults are deploy-time configurable and MUST be enforced before or during parsing:

- 100 evaluation sets per data root.
- 200 models and 1,000 declared model/step pairs per evaluation set.
- 100 MiB per `set.json` and 100,000 records per file.
- 50 MiB per image.
- 100 levels of JSON nesting and 10,000 keys/elements within one record.
- 1 MiB maximum encoded value size for one record.

Limit violations are actionable diagnostics. These safeguards prevent accidental or hostile local files from exhausting the server or browser. Engineering MAY lower defaults after performance testing but MUST document the deployed values.

## 6. URL state contract

Use query parameters on the app route. Values MUST be URL encoded with `URLSearchParams`. The canonical parameter order is shown below:

```text
/?eval=sample-eval&view=models&cols=model-a%3A1000,model-b%3A2000&q=cat&order=shuffle&seed=123&page=2&pageSize=25&active=model-a%3A1000%3A42
```

| Parameter | Required/default | Meaning |
| --- | --- | --- |
| `eval` | none | Evaluation-set ID |
| `view` | `models` | `models`, later `gallery`, `steps`, or `table` |
| `cols` | empty | Ordered comma-separated `model_id:step` tuples |
| `q` | empty | Literal search string |
| `order` | `id` | `id` or `shuffle` |
| `seed` | omitted for `id` | Unsigned 32-bit decimal shuffle seed |
| `page` | `1` | One-based positive integer |
| `pageSize` | `25` | One of 10, 25, 50, 100 |
| `active` | none | `model_id:step:prompt_id` for the open lightbox |

Defaults SHOULD be omitted from the canonical URL. The client MUST parse defensively, validate values against server metadata, preserve no unknown parameters, and use `history.replaceState` for canonicalization. Normal user changes SHOULD use `pushState`; rapid search typing and resize changes SHOULD use `replaceState` or local state to avoid polluting browser history. Search updates MUST be debounced by 250–400 ms while the input itself remains immediate.

Do not place prompts, record JSON, absolute file paths, or image paths in the URL. URLs can expose dataset/model identifiers and search terms through browser history and server logs; the UI MUST mention this beside “Copy link” when deployments may contain sensitive identifiers.

## 7. Interface and interaction design

### 7.1 Application shell

The page consists of a top bar, left navigation, and main comparison canvas. The top bar contains the product name, current evaluation-set title, reload status/action, and copy-link action. The navigation is independently scrollable. The main region contains view tabs, comparison controls, diagnostics banner, aligned grid, and pagination.

Each comparison column has a sticky header with model label, step, drag handle, keyboard move menu/buttons, and remove action. The first narrow sticky column displays `prompt_id`. On small screens the grid scrolls horizontally rather than compressing content below a usable width.

### 7.2 Cell states

A cell has exactly one primary state:

- **Populated:** prompt label and selectable text; prompt-output label and selectable text; image button.
- **Missing record:** neutral dashed container, missing icon, and explicit prompt-ID message.
- **Dataset unavailable:** error container with short cause and diagnostics link.
- **Image missing/broken:** prompt fields remain visible; the image region shows an error icon, expected filename, and diagnostics link.
- **Loading:** shape-preserving skeleton marked `aria-busy="true"`; it must not be announced repeatedly.

Missing data is not represented by an empty white box. Error and warning states use icon, heading, and text in addition to color.

### 7.3 Lightbox

Use a semantic modal dialog with an accessible name. Desktop layout gives the image the remaining width and places details at right; mobile stacks them. The original image may fit within the viewport and support zoom-to-actual-size plus pan once zoomed. Controls include close, previous, next, fit/actual-size, and copy field value. Browser-level image download is permitted only if normal deployment policy allows it; no dedicated download feature is required.

The details tree initially expands top-level scalar fields and collapses top-level arrays/objects. It displays keys, type badges, scalar values, item counts, and disclosure controls. Arrays retain order. Objects retain source key order. Virtualize or progressively render very large nested collections so opening a record does not lock the UI.

### 7.4 Visual system and brand baseline

No organization-specific brand assets or tokens are present in this repository. Until they are supplied, use a restrained, neutral research-tool theme driven by CSS custom properties rather than hard-coded component colors:

- System sans-serif UI font and system monospace font for IDs/JSON.
- Light theme initially; components must be tokenized so a dark theme can be added without rewriting them.
- Minimum 4.5:1 text contrast and 3:1 meaningful non-text/UI contrast.
- Clearly visible 2 px focus ring with at least 3:1 contrast against adjacent colors.
- An 8 px spacing base, 4 px fine spacing, modest 6–8 px corner radii, and no decorative motion.
- Status colors paired with icons and labels. Model identity uses text labels; optional colors are supplemental.
- Respect `prefers-reduced-motion`; transitions should be under 200 ms and not required to understand state.

DiVE is a behavioral and information-architecture reference, not a license to copy proprietary logos, brand assets, exact visual trade dress, or source code. Product/design must approve final tokens and naming before public release.

### 7.5 Accessibility requirements

The implementation MUST target WCAG 2.2 AA:

- All functions are operable with keyboard alone, including column reorder and pane resize.
- Controls use native elements where possible and have visible labels or accessible names.
- The comparison grid uses appropriate table/grid semantics only if the full keyboard interaction pattern is implemented; otherwise use headings and regions with a real table for row/column relationships.
- Focus order follows visual order. Sticky elements do not obscure focused content.
- Reload, validation, and result-count changes use a polite live region; errors that block work receive focus at the next sensible boundary.
- Touch targets are at least 24 by 24 CSS px, with 44 by 44 px preferred for primary controls.
- Text remains selectable, reflows at 200% zoom, and does not rely on hover.
- Automated accessibility checks are necessary but do not replace keyboard and screen-reader testing.

## 8. Technical architecture

### 8.1 Recommended stack

- Node.js active LTS, TypeScript with `strict` mode.
- React and Vite for the client.
- Fastify for a minimal read-only HTTP API and production static asset serving.
- JSON Schema 2020-12 with Ajv for manifest and record validation.
- React Router or a small typed URL-state adapter for query synchronization.
- CSS Modules or plain layered CSS with design tokens; avoid a heavyweight component system unless the team already has an approved one.
- Vitest, React Testing Library, Playwright, and axe-core for tests.

Pin direct dependencies and the package-manager lockfile. The engineering team may substitute established organization-standard equivalents, but the filesystem/API trust boundary and behavioral contracts in this document remain normative.

### 8.2 Suggested source layout

```text
src/
  client/
    components/
    features/comparison/
    features/details/
    state/urlState.ts
    styles/tokens.css
  server/
    api/
    catalog/
    validation/
    images/
  shared/
    contracts/
    diagnostics/
fixtures/
  eval-sets/
tests/
data/eval-sets/              # ignored local data; keep .gitkeep
```

Fixtures MUST live outside `data/eval-sets/` so representative small datasets can be committed despite the existing ignore rule.

### 8.3 Server responsibilities

The server:

1. Resolves and verifies the configured data root at startup.
2. Scans direct child manifests and builds immutable catalog snapshots.
3. Validates manifests before using any declared path.
4. Loads selected datasets, parsing and validating all records while retaining raw valid records.
5. Builds a `Map<prompt_id, record>` per model/step and image availability metadata.
6. Produces public, relative resource IDs and diagnostics; it never returns absolute paths or stack traces.
7. Serves only allowlisted image files resolved from validated tuples.
8. Atomically swaps valid snapshots on reload and exposes a monotonically changing snapshot ID/ETag.

The client performs alignment, search, deterministic ordering, and pagination for Milestone 1. This gives immediate interaction after selected datasets load and keeps share-state behavior testable. Before release, performance testing against the documented maximums must confirm this remains responsive. If payload size or memory targets fail, move those operations behind a server query endpoint while preserving the same semantics and URL contract.

### 8.4 Client state model

Separate state into:

- **URL state:** eval set, view, ordered columns, search, order, seed, page, page size, active record.
- **Server state:** catalog, selected dataset snapshots, image metadata, diagnostics, reload state.
- **Device preference:** navigation collapsed/width and details width in local storage.
- **Ephemeral state:** menu state, drag preview, image zoom, pending search text, and focus-return target.

Derive aligned and visible rows with memoized pure functions. Do not duplicate derived row arrays in global mutable state. Use tuple keys created by a length-safe serializer or structured objects, not ambiguous string concatenation internally.

### 8.5 HTTP API

All success and error bodies are JSON except images. API errors follow `{ "error": { "code": string, "message": string, "request_id": string } }` and omit internal paths/stacks.

| Method/path | Purpose |
| --- | --- |
| `GET /api/v1/catalog` | Valid eval sets, manifest summary, catalog diagnostics, snapshot ID |
| `GET /api/v1/eval-sets/:eval/models/:model/steps/:step` | Valid records, image status, dataset diagnostics, snapshot ID |
| `GET /api/v1/images/:eval/:model/:step/:promptId` | Validated image bytes with correct media type and nosniff headers |
| `POST /api/v1/reload` | Rescan data root and atomically refresh snapshots |
| `GET /api/v1/health` | Process readiness; no filesystem or secret detail |

The dataset response shape is:

```ts
type DatasetResponse = {
  eval_set_id: string;
  model_id: string;
  step: number;
  snapshot_id: string;
  records: RecordV1[];
  images: Record<string, {
    status: "available" | "missing" | "ambiguous" | "invalid";
    url?: string;
    media_type?: "image/webp" | "image/png" | "image/jpeg";
    file_name?: string;
    width?: number;
    height?: number;
  }>;
  diagnostics: Diagnostic[];
};
```

The shared diagnostic shape is:

```ts
type Diagnostic = {
  severity: "warning" | "error";
  code:
    | "MANIFEST_INVALID"
    | "UNSUPPORTED_SCHEMA_VERSION"
    | "SET_JSON_INVALID"
    | "RECORD_INVALID"
    | "DUPLICATE_PROMPT_ID"
    | "IMAGE_MISSING"
    | "IMAGE_AMBIGUOUS"
    | "IMAGE_DECODE_FAILED"
    | "STALE_SNAPSHOT"
    | "RESOURCE_LIMIT_EXCEEDED";
  message: string;
  eval_set_id?: string;
  model_id?: string;
  step?: number;
  public_path?: string;       // data-root-relative, never absolute
  record_index?: number;
  prompt_id?: number;
};
```

Use `Cache-Control: no-cache` plus ETag for JSON so clients revalidate. Images MAY use short private caching with ETag. Reload requires same-origin requests and SHOULD return `202` only if implemented asynchronously; otherwise return the completed new catalog snapshot.

### 8.6 Loading and failure behavior

- Fetch selected columns concurrently with bounded client concurrency (default 4).
- Abort requests for columns removed before completion.
- A failure in one column must not blank successful columns.
- Reload shows progress, keeps the current valid view available, then reconciles selections against the new catalog.
- Network errors offer Retry. Schema errors link to diagnostics and do not retry automatically in a loop.
- Empty valid datasets are allowed and show an empty-dataset state.

## 9. Security and privacy

### 9.1 Trust model

Dataset JSON and images are untrusted input even when loaded from local disk. The service is read-only and intended by default for loopback or an authenticated internal reverse proxy. It MUST bind to `127.0.0.1` by default. Binding to a non-loopback interface requires an explicit configuration flag and a startup warning; production exposure requires organization-approved authentication and TLS at the proxy or service boundary.

### 9.2 Required controls

- Validate identifiers before path lookup; resolve paths beneath the canonical data root and reject symlinks and traversal.
- Serve images through the tuple API, not a general static mount of `data/`.
- Determine media type from the allowlisted extension and verify file signatures for WebP, PNG, and JPEG before serving.
- Set `X-Content-Type-Options: nosniff`, a restrictive Content Security Policy, `Referrer-Policy: no-referrer`, and deny framing unless deployment requirements explicitly allow it.
- Recommended CSP: `default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`. Avoid inline script/style exceptions. The local HTTP deployment MUST omit `upgrade-insecure-requests` and HSTS because Safari/WebKit otherwise upgrades loopback assets to unavailable HTTPS URLs; a future HTTPS network deployment SHOULD enable them at its trusted TLS terminator.
- Render all JSON and diagnostics through text nodes; do not use raw HTML injection.
- Restrict API CORS to same-origin by default. Do not use wildcard origins.
- Apply request-body and rate limits to reload; it has no body and should be disabled or proxy-authorized on shared deployments.
- Avoid logging prompts, prompt outputs, arbitrary record data, search queries, or full URLs. Log request ID, route template, status, timing, and public dataset tuple only when policy permits.
- Return generic client errors and structured diagnostics; log sensitive internal detail only to protected server logs.
- Run dependency audit, secret scanning, and static analysis in CI. Produce/update a lockfile and review high/critical findings before release.
- Run the service as an unprivileged account with read-only access to the data root in production.

SVG and other active image formats are intentionally unsupported in version 1. `README.md` is not rendered. These choices reduce stored-content injection risk.

### 9.3 Privacy considerations

Evaluation prompts and images may contain confidential, personal, unsafe, or offensive content. Milestone 1 provides no content moderation, redaction, or access control. Deployers are responsible for lawful datasets and access restrictions. The UI SHOULD show an environment-configurable content notice. Record content is never sent to third parties by the application, and analytics/telemetry MUST be off by default. Clipboard actions occur only after explicit user action.

## 10. Performance and quality attributes

- **NFR-001:** On the reference development machine with two 10,000-record columns and cached local files, search/order/page updates SHOULD complete within 100 ms at the 95th percentile; interaction response MUST remain under 200 ms.
- **NFR-002:** Initial application chrome SHOULD become interactive within 2 seconds on a current desktop browser before datasets finish loading.
- **NFR-003:** The client MUST not fetch full image bytes until an image enters or nears the viewport; the lightbox may fetch the selected full image immediately.
- **NFR-004:** Layout shift from image loading SHOULD remain below 0.1 by reserving aspect-ratio space when dimensions are known.
- **NFR-005:** A malformed column or failed image MUST be isolated and must not crash the application shell.
- **NFR-006:** Support the latest two stable releases of Chrome/Edge, Firefox, and Safari at release time.
- **NFR-007:** Production client builds MUST not expose server filesystem paths or source maps unless access is controlled.

## 11. Validation and test plan

### 11.1 Required fixtures

Commit small fixtures covering:

- Same `prompt_id` with different prompts in two models.
- IDs present in only one model on both sides of the join.
- Empty prompts and Unicode text.
- Nested objects, arrays, booleans, numbers, strings, and null extra fields.
- WebP, PNG, JPEG, missing image, ambiguous image, and corrupt image bytes.
- Invalid JSON, invalid required field types, unsafe IDs, duplicate IDs, too-deep data, and unsupported schema versions.
- Empty valid `set.json` and a model with multiple steps.

### 11.2 Automated tests

- **Schema/unit:** manifest strictness, record preservation, duplicate detection, limits, diagnostic codes, signature validation, and safe path resolution.
- **Pure behavior:** union alignment, model-owned text, literal Unicode search, processing order, xmur3 shuffle golden vectors, URL parse/serialize/canonicalize, and active-record reconciliation.
- **Component:** all cell states, nested inspector, focus restoration, keyboard reorder/resize, live announcements, error isolation, and responsive behavior.
- **API integration:** atomic reload, stale snapshot handling, ETag behavior, headers/CSP, same-origin enforcement, path traversal/symlink rejection, and content types.
- **End-to-end:** select two columns without reload; reorder/remove; compare divergent prompts; inspect exact record; share/reopen URL; reload added data; handle missing IDs/images; paginate and reproduce shuffle.
- **Accessibility:** axe scans at zero serious/critical findings plus manual keyboard, zoom/reflow, VoiceOver/Safari, and NVDA or JAWS/Chrome coverage.
- **Visual regression:** representative populated, missing, error, lightbox, narrow viewport, and 200% zoom states using approved tokens.

### 11.3 Acceptance traceability

| Intent acceptance criterion | Verification |
| --- | --- |
| Second model creates a column without reload | Playwright network/navigation assertion |
| Different prompts with same ID share a row | Alignment unit test and end-to-end fixture |
| Field order is prompt, output, image | Component DOM-order assertion |
| Image opens exact record and all details | End-to-end tuple/header and recursive-field assertions |
| Unknown fields need no UI schema change | Fixture with new nested key and inspector assertion |
| Missing/malformed data is diagnosable | Schema/API/component diagnostic tests |
| Copied URL reconstructs state | URL golden test and new-context end-to-end test |
| No GeoBanana runtime dependency | Dependency/source scan in CI |

## 12. Delivery plan and exit criteria

### Phase 1: contract and scaffold

- Approve the schemas in Section 5 and commit JSON Schema files plus fixtures.
- Scaffold the strict TypeScript client/server and CI quality gates.
- Implement catalog discovery, validation, safe image resolution, and API integration tests.

Exit: fixtures validate deterministically; unsafe paths and malformed data have stable diagnostics.

### Phase 2: Models core

- Implement selection, aligned grid, all cell states, concurrent dataset loading, and responsive shell.
- Implement the lightbox/details inspector and accessibility behavior.

Exit: FR-010 through FR-018 and FR-030 through FR-040 pass automated and manual tests.

### Phase 3: explorer controls

- Add URL state, search, deterministic shuffle, pagination, reorder, pane collapse/resize, reload, and full diagnostics UI.
- Run accessibility, security, and performance checks.

Exit: all Milestone 1 functional requirements and intent acceptance criteria pass; product/design/security review unresolved items in Section 13.

### Phase 4: later views and advanced analysis

- Specify and implement Gallery, Steps, Table, filters, sorting, grouping, and extra-field selection.
- Version schemas for explicit/multiple images only when needed.

Exit: each view receives its own interaction and acceptance addendum before implementation.

### Phase 5: separate GeoBanana cleanup

Begin only after replacement workflows are accepted. Inventory consumers before deleting old renderer, contract, adapters, and launch/config documentation. Review `compare_strip.py` independently and preserve unrelated evaluation/image-analysis utilities.

## 13. Concerns, conflicts, and decisions required

### 13.1 Missing organization policy inputs — release blocker

No brand guideline, approved design system, security policy, privacy/data-classification policy, deployment topology, or organization-specific UX standard exists in this repository, and no applicable policy skill was available in the current environment. Therefore this specification cannot certify compliance with unknown organization rules. It uses WCAG 2.2 AA, OWASP-style web controls, a neutral tokenized visual baseline, loopback-by-default serving, and no telemetry as conservative defaults.

Before implementation is declared release-ready, owners must provide or explicitly approve:

- Product name, logo usage, typography, colors, tone, and whether close visual resemblance to DiVE is legally/brand acceptable.
- Required browser/accessibility targets and the organization's approved component library.
- Data classification for prompts/images/metadata, retention/logging rules, content-safety requirements, and whether browser caching/clipboard use is allowed.
- Authentication, authorization, TLS, network exposure, audit logging, dependency, and vulnerability-remediation requirements.
- Maximum expected dataset sizes and the reference performance environment.

If an organization policy conflicts with this document, that policy takes precedence and this spec must be revised with the decision recorded.

### 13.2 “Every field” versus safe rendering — resolved

The intent requires every arbitrary JSON field to be inspectable. Security requires untrusted content not execute. Both are satisfied by preserving every valid JSON value and rendering it only as inert, escaped text in a recursive inspector. HTML/Markdown rendering and clickable arbitrary links are prohibited. This changes presentation, not data fidelity.

### 13.3 Invalid records versus union alignment — resolved

The intent says malformed records are never silently dropped, but an invalid or duplicate ID cannot be joined safely. Invalid records are excluded from alignment and displayed in a persistent diagnostic list with source index and reason. Duplicate IDs invalidate the dataset. This is the only deterministic behavior that avoids fabricating a record choice.

### 13.4 Reload versus stable review — resolved

Automatically replacing data mid-review can move rows and invalidate the active record. File changes are detected, but snapshots switch atomically; explicit reload is always available, stale state is labeled, and selections are reconciled after a swap. Engineering should decide after usability testing whether passive change detection should auto-apply or only prompt the user. The conservative recommendation for Milestone 1 is prompt-then-apply.

### 13.5 URL completeness versus confidentiality and length — accepted limitation

The required state is encoded in the URL, so evaluation/model IDs and searches may enter history and logs. Record content is excluded. Very many selected columns can exceed practical URL limits; the UI SHOULD warn at 1,800 encoded characters but MUST still permit copying. Server-side saved views would solve this but add persistence, access control, and non-portable identifiers and are out of scope.

### 13.6 Client-side processing versus maximum scale — decision gate

Client-side alignment offers simple, responsive behavior but can be expensive at the contract maximum. The architecture includes a pre-release performance gate. If it misses NFR-001 or causes unacceptable payload/memory use, engineering must implement server-side query processing with identical semantics before release, not merely raise the target.

### 13.7 DiVE fidelity versus independent product identity — decision required

“Follow as closely as practical” is interpreted as matching workflows, information hierarchy, and interaction quality—not copying proprietary assets or exact styling. Product/legal should validate this interpretation and any applicable reference licenses before public distribution.

### 13.8 Scope tension around later views — resolved by milestones

The intent targets four view modes but prioritizes Models. Milestone 1 is not complete for the entire product vision, only the explicitly defined Models release. Gallery, Steps, and Table require view-specific requirements before implementation. Unsupported view values fall back visibly and never imply those views already exist.

### 13.9 Dynamic layout versus CSP style attributes — accepted local-only exception

Resizable panes and drag positioning require React and the drag library to write computed style attributes. The implementation therefore permits `'unsafe-inline'` for `style-src-attr` while keeping scripts, style sheets, connections, images, objects, frames, base URIs, and forms under the restrictive policy in Section 9. No dataset value is interpolated into a style attribute, and record content remains text-only. This is an explicit, limited exception to the preferred no-inline-style policy and must be reconsidered before any non-loopback deployment.

## 14. Open engineering decisions

These choices do not block contract fixture work but must be recorded before their affected phase:

1. Confirm the organization-standard package manager, Node LTS version, CI platform, and deployment packaging.
2. Approve the recommended client/server libraries or document equivalent substitutions.
3. Decide whether passive filesystem detection prompts or automatically applies a valid new snapshot; recommendation: prompt.
4. Establish measured data-size percentiles and decide at the performance gate whether querying remains client-side.
5. Supply and approve brand/design/security/privacy inputs listed in Section 13.1.
6. Define detailed requirements for Gallery, Steps, Table, and advanced field operations before Phase 4.

## 15. Definition of done for Milestone 1

Milestone 1 is done only when:

- Sections 4.1–4.6 are implemented and acceptance-traced tests pass.
- Versioned JSON Schemas and all required fixtures are committed.
- The application runs without GeoBanana source or adapters and with an empty data root.
- Added valid eval sets, models, steps, records, and supported images appear after reload without a build.
- WCAG checks and manual keyboard/screen-reader review pass the stated baseline.
- Threat-focused tests cover traversal, symlinks, content injection, malformed payloads, and resource limits.
- Performance is measured against realistic datasets and either meets Section 10 or uses the server-query fallback.
- Product/design/security owners approve the policy decisions or this specification is amended to their supplied standards.
- Setup, data-contract, troubleshooting, and deployment documentation are ready for an engineer unfamiliar with the repository.
