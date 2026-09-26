# R30 Explorer v2 specification

Status: implementation authority. The earlier [v1 spec](spec.md) is historical. The
[GeoBanana handoff](https://github.com/Norman-Ou/GeoBanana/tree/codex/e6-r30-handoff-20260926/docs/sft/r30_explorer)
owns the upstream intent and two independent data producers; this repository owns only the viewer.

The viewer discovers zero, one, or two published R30 datasets from `T2I_DATA_ROOT`. It does not
require both datasets or import real source data. The root URL shows the chooser in Gallery mode.
A valid deep link restores dataset, mode, ordered unique column instances, search, shuffle, page,
and active cell. Invalid tuples are removed with a visible notice. All columns carry task and
named step identity; adding the same pair twice yields separate movable/removable instances.

Gallery presents the available pairs; Models chooses task then step, and Steps chooses step then
task. All modes retain selected columns. Each cell shows its actual source ID, review stage,
labeled Original | Auxiliary | Output composite, exact Message input/output, and separate source
annotation when available. `null` means unavailable; the empty string is displayed distinctly.
A text-only target may have a review visualization labeled `output_aux`. Ordinal alignment does
not assert that sources are shared between columns.

The v2 paths, schemas, API, statuses and record fields are described in [README](README.md).
Only declared tuples and validated `sample-{index}` media are served from beneath the root.
Symlinks, unsafe IDs, mismatched counts, unsupported versions, duplicate indices, malformed
records, invalid image signatures, excessive resources and host violations are rejected or
reported. Provenance paths are rendered as text only. The UI retains keyboard operation, focus
return, rail collapse/resize, accessible labels and responsive layout. Its visual reference is
the GeoBanana R30 handoff's three screenshots.

Acceptance checks: typecheck, lint, unit/API tests, production build and browser tests. Fixture
coverage includes empty root, independent dataset discovery, named steps, blocked pairs, exact
text, duplicate columns, URL restoration, safe serving and screen-reader checks. Publication of
either real dataset is separately validated by its data producer.
