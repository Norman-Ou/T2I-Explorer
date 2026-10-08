import type { ExperimentResponse, SampleView } from "./contracts.js";
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
    expOrder?: number;
    data?: ExperimentResponse;
    error?: string;
};
export type AlignedRow = {
    sampleIndex: number;
    records: Map<string, SampleView>;
};
export function alignRows(columns: LoadedColumn[]): AlignedRow[] {
    const groups = new Map<string, LoadedColumn[]>();
    for (const column of columns) {
        const data = column.data;
        const groupKey = data ? JSON.stringify([data.collection_id, data.task_id, data.dataset_id]) : `loading:${column.key}`;
        const group = groups.get(groupKey) ?? [];
        group.push(column);
        groups.set(groupKey, group);
    }
    const alignedGroups = [...groups.values()].map(group => {
        const priority = (column: LoadedColumn) => column.data && column.data.exp_id === "baseline" ? -1 : column.expOrder ?? 0;
        const sorted = [...group].sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
        const ids: string[] = [];
        const seen = new Set<string>();
        const maps = new Map<string, Map<string, SampleView>>();
        for (const column of sorted) {
            const records = [...(column.data?.records ?? [])].sort((a, b) => a.index - b.index);
            maps.set(column.key, new Map(records.map(record => [record.sample_id, record])));
            for (const record of records)
                if (!seen.has(record.sample_id)) {
                    seen.add(record.sample_id);
                    ids.push(record.sample_id);
                }
        }
        return ids.map(id => new Map(group.flatMap(column => { const record = maps.get(column.key)?.get(id); return record ? [[column.key, record] as const] : []; })));
    });
    const count = Math.max(0, ...alignedGroups.map(group => group.length));
    return Array.from({ length: count }, (_, index) => ({ sampleIndex: index + 1, records: new Map(alignedGroups.flatMap(group => [...(group[index] ?? [])])) }));
}
export function filterRows(rows: AlignedRow[], query: string, labels: string[] = []): AlignedRow[] {
    const needle = query.trim().toLowerCase();
    if (!needle)
        return rows;
    if (labels.some((label) => label.toLowerCase().includes(needle)))
        return rows;
    return rows.filter((row) => String(row.sampleIndex).includes(needle) || [...row.records.values()].some((record) => [record.sample_id, record.input_text, record.pred_text, record.gt_text, ...record.extra_texts?.map(item => item.text) ?? []].some((value) => value?.toLowerCase().includes(needle))));
}
export function orderRows(rows: AlignedRow[], order: "id" | "shuffle", seed: number): AlignedRow[] {
    if (order === "id")
        return [...rows].sort((a, b) => a.sampleIndex - b.sampleIndex);
    return [...rows].sort((a, b) => rowHash(`t2i-explorer:3:${seed}:${a.sampleIndex}`) - rowHash(`t2i-explorer:3:${seed}:${b.sampleIndex}`) || a.sampleIndex - b.sampleIndex);
}
