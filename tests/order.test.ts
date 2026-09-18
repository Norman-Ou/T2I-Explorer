import { describe, expect, it } from "vitest";
import type { DatasetResponse } from "../src/shared/contracts.js";
import { alignRows, filterRows, orderRows, rowHash } from "../src/shared/order.js";

function dataset(model: string, records: DatasetResponse["records"]): DatasetResponse {
  return { eval_set_id: "eval", model_id: model, step: 1, snapshot_id: model, records, images: {}, diagnostics: [] };
}

describe("row alignment and ordering", () => {
  const columns = [
    { key: "a:1", data: dataset("a", [
      { prompt_id: 1, prompt: "Alpha", prompt_output: "first" },
      { prompt_id: 3, prompt: "Shared ID, own wording", prompt_output: "third" }
    ]) },
    { key: "b:1", data: dataset("b", [
      { prompt_id: 2, prompt: "Beta", prompt_output: "second" },
      { prompt_id: 3, prompt: "Different wording", prompt_output: "other third" }
    ]) }
  ];

  it("joins only on the union of numeric prompt IDs", () => {
    const rows = alignRows(columns);
    expect(rows.map((row) => row.promptId)).toEqual([1, 2, 3]);
    expect(rows[0]?.records.has("b:1")).toBe(false);
    expect(rows[2]?.records.get("a:1")?.prompt).toBe("Shared ID, own wording");
    expect(rows[2]?.records.get("b:1")?.prompt).toBe("Different wording");
  });

  it("searches ID, prompt, and output literally without shifting alignment", () => {
    const rows = alignRows(columns);
    expect(filterRows(rows, "BETA").map((row) => row.promptId)).toEqual([2]);
    expect(filterRows(rows, "other third").map((row) => row.promptId)).toEqual([3]);
    expect(filterRows(rows, "1").map((row) => row.promptId)).toEqual([1]);
  });

  it("uses the normative deterministic hash and stable collision tie-break", () => {
    expect(rowHash("t2i-explorer:v1:123:1")).toBe(3868911782);
    expect(rowHash("t2i-explorer:v1:123:42")).toBe(3761190585);
    expect(orderRows(alignRows(columns), "shuffle", 123).map((row) => row.promptId)).toEqual([2, 3, 1]);
  });

  it("keeps a 20,000-record two-column interaction comfortably bounded", () => {
    const records = Array.from({ length: 10_000 }, (_, prompt_id) => ({ prompt_id, prompt: `Prompt ${prompt_id}`, prompt_output: `Output ${prompt_id}` }));
    const start = performance.now();
    const rows = orderRows(filterRows(alignRows([
      { key: "a:1", data: dataset("a", records) },
      { key: "b:1", data: dataset("b", records.map((record) => ({ ...record, prompt: `Other ${record.prompt_id}` }))) }
    ]), "prompt 999"), "shuffle", 42);
    expect(rows).toHaveLength(11);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
