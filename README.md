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

```text
data/eval-sets/
└── {eval_set}/
    ├── manifest.json
    └── models/{model_id}/s{step}/
        ├── set.json
        └── p{prompt_id}.{webp,png,jpg,jpeg}
```

`manifest.json` declares every selectable model/step. The normative schemas are in `schemas/`. A record requires `prompt_id`, `prompt`, and `prompt_output`; all additional JSON fields are retained and shown in the details inspector. Image precedence is WebP, PNG, JPG, then JPEG. Duplicate IDs invalidate a dataset. Other invalid records remain visible through diagnostics and do not participate in alignment.

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
