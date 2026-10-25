export type ViewMode = "task" | "exp";
export type ViewState = {
    datasetId?: string;
    mode: ViewMode;
    columns: string[];
    query: string;
    page: number;
    pageSize: 10 | 25 | 50 | 100;
    active?: string;
    notice?: string;
};
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const instance = /^[A-Za-z0-9_-]{1,32}$/;
const pageSizes = new Set([10, 25, 50, 100]);
export function tupleParts(value: string) {
    const parts = value.split(":");
    if (parts.length !== 4 || !parts.slice(0, -1).every(part => id.test(part)) || !instance.test(parts.at(-1)!))
        return undefined;
    return { taskId: parts[0]!, datasetId: parts[1]!, expId: parts[2]!, instanceId: parts.at(-1)! };
}
export function activeParts(value?: string) {
    if (!value)
        return undefined;
    const split = value.lastIndexOf(":");
    const key = value.slice(0, split);
    const sampleId = value.slice(split + 1);
    return tupleParts(key) && id.test(sampleId) ? { key, sampleId } : undefined;
}
export function parseViewState(search: string): ViewState {
    const params = new URLSearchParams(search);
    const columns = [...new Set((params.get("cols") ?? "").split(",").filter(value => tupleParts(value)))];
    const rawPage = Number(params.get("page"));
    const rawSize = Number(params.get("pageSize"));
    const datasetId = params.get("dataset") ?? undefined;
    const rawActive = params.get("active") ?? undefined;
    return {
        ...(datasetId && id.test(datasetId) ? { datasetId } : {}), mode: params.get("mode") === "exp" ? "exp" : "task",
        columns, query: params.get("q") ?? "",
        page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
        pageSize: (pageSizes.has(rawSize) ? rawSize : 25) as ViewState["pageSize"],
        ...(rawActive && activeParts(rawActive) ? { active: rawActive } : {})
    };
}
export function serializeViewState(state: ViewState): string {
    const params = new URLSearchParams();
    if (state.datasetId)
        params.set("dataset", state.datasetId);
    if (state.mode === "exp")
        params.set("mode", "exp");
    if (state.columns.length)
        params.set("cols", state.columns.join(","));
    if (state.query)
        params.set("q", state.query);
    if (state.page !== 1)
        params.set("page", String(state.page));
    if (state.pageSize !== 25)
        params.set("pageSize", String(state.pageSize));
    if (state.active)
        params.set("active", state.active);
    const encoded = params.toString();
    return encoded ? `?${encoded}` : "";
}

/** Resolve read-only collection aliases without changing the user's view. */
export function canonicalViewState(state: ViewState, collections: Array<{ id: string; aliases?: string[] }>): ViewState {
    const collection = collections.find(item => item.id === state.datasetId || item.aliases?.includes(state.datasetId ?? ''));
    return collection && collection.id !== state.datasetId ? { ...state, datasetId: collection.id } : state;
}
