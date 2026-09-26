import type { DatasetResponse, RecordV2 } from "./contracts.js";
export function rowHash(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) { h = Math.imul(h ^ input.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
export type LoadedColumn = { key: string; data?: DatasetResponse; error?: string };
export type AlignedRow = { sampleIndex: number; records: Map<string, RecordV2> };
export function alignRows(columns: LoadedColumn[]): AlignedRow[] {
  const ids = new Set<number>(); const maps = new Map<string, Map<number, RecordV2>>();
  for (const column of columns) {
    const byId = new Map<number, RecordV2>();
    for (const record of column.data?.records ?? []) { ids.add(record.sample_index); byId.set(record.sample_index, record); }
    maps.set(column.key, byId);
  }
  return [...ids].sort((a,b) => a-b).map((sampleIndex) => ({ sampleIndex,
    records: new Map(columns.map((column) => [column.key, maps.get(column.key)?.get(sampleIndex)]).filter((entry): entry is [string, RecordV2] => entry[1] !== undefined)) }));
}
export function filterRows(rows: AlignedRow[], query: string, labels: string[] = []): AlignedRow[] {
  const needle = query.trim().toLowerCase(); if (!needle) return rows;
  if (labels.some((label) => label.toLowerCase().includes(needle))) return rows;
  return rows.filter((row) => String(row.sampleIndex).includes(needle) || [...row.records.values()].some((record) =>
    [record.source_sample_id, record.message_input_text, record.message_output_text, record.paper_input_text, record.paper_output_text, record.source_annotation_text, record.source_dataset].some((value) => value?.toLowerCase().includes(needle))));
}
export function orderRows(rows: AlignedRow[], order: "id" | "shuffle", seed: number): AlignedRow[] {
  if (order === "id") return [...rows].sort((a,b) => a.sampleIndex-b.sampleIndex);
  return [...rows].sort((a,b) => rowHash(`t2i-explorer:v2:${seed}:${a.sampleIndex}`)-rowHash(`t2i-explorer:v2:${seed}:${b.sampleIndex}`) || a.sampleIndex-b.sampleIndex);
}
