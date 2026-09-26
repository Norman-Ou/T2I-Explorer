import { describe, expect, it } from "vitest";
import { alignRows, filterRows, orderRows } from "../src/shared/order.js";
import type { DatasetResponse, RecordV2 } from "../src/shared/contracts.js";
const record = (sample_index: number, source_sample_id: string): RecordV2 => ({ sample_index, source_sample_id, review_stage: "accepted_e6_sft_row", message_input_text: "<SEG> target", message_output_text: "", source_annotation_text: null, source_dataset: "SIOR_T", source_split: "train", source_manifest_path: null, panel_roles: ["original","input_aux","output"], asset_paths: {}, evidence: {} });
const data = (records: RecordV2[]): DatasetResponse => ({ dataset_id: "sft-e6.0-r30", model_id: "refseg", step_id: "sior-t", snapshot_id: "x", records, images: {}, diagnostics: [] });
describe("ordinal alignment", () => {
  it("aligns by ordinal and keeps duplicate column instances distinct", () => {
    const rows = alignRows([{ key: "a", data: data([record(1,"source-A")]) },{ key: "b", data: data([record(1,"source-B"),record(2,"source-C")]) }]);
    expect(rows.map((row) => row.sampleIndex)).toEqual([1,2]);
    expect(rows[0]?.records.get("a")?.source_sample_id).toBe("source-A");
    expect(rows[0]?.records.get("b")?.source_sample_id).toBe("source-B");
    expect(rows[1]?.records.has("a")).toBe(false);
  });
  it("searches exact text and source IDs and shuffles deterministically", () => {
    const rows = alignRows([{ key: "a", data: data([record(1,"source-A"),record(2,"source-B")]) }]);
    expect(filterRows(rows,"<SEG>")).toHaveLength(2);
    expect(filterRows(rows,"source-B").map((row) => row.sampleIndex)).toEqual([2]);
    expect(orderRows(rows,"shuffle",42)).toEqual(orderRows(rows,"shuffle",42));
  });
});
