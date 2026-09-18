import type { DatasetResponse, RecordV1 } from "./contracts.js";

export function rowHash(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export type LoadedColumn = {
  key: string;
  data?: DatasetResponse;
  error?: string;
};

export type AlignedRow = {
  promptId: number;
  records: Map<string, RecordV1>;
};

export function alignRows(columns: LoadedColumn[]): AlignedRow[] {
  const ids = new Set<number>();
  const maps = new Map<string, Map<number, RecordV1>>();
  for (const column of columns) {
    const byId = new Map<number, RecordV1>();
    for (const record of column.data?.records ?? []) {
      ids.add(record.prompt_id);
      byId.set(record.prompt_id, record);
    }
    maps.set(column.key, byId);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((promptId) => ({
      promptId,
      records: new Map(columns.map((column) => [column.key, maps.get(column.key)?.get(promptId)]).filter(
        (entry): entry is [string, RecordV1] => entry[1] !== undefined
      ))
    }));
}

export function filterRows(rows: AlignedRow[], query: string): AlignedRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    if (String(row.promptId).includes(needle)) return true;
    return [...row.records.values()].some(
      (record) =>
        record.prompt.toLowerCase().includes(needle) ||
        record.prompt_output.toLowerCase().includes(needle)
    );
  });
}

export function orderRows(rows: AlignedRow[], order: "id" | "shuffle", seed: number): AlignedRow[] {
  if (order === "id") return [...rows].sort((a, b) => a.promptId - b.promptId);
  return [...rows].sort((a, b) => {
    const ah = rowHash(`t2i-explorer:v1:${seed}:${a.promptId}`);
    const bh = rowHash(`t2i-explorer:v1:${seed}:${b.promptId}`);
    return ah - bh || a.promptId - b.promptId;
  });
}
