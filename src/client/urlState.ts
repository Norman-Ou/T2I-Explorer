export type Mode = "gallery" | "steps" | "models";
export type ViewState = {
  datasetId?: string;
  mode: Mode;
  columns: string[];
  query: string;
  order: "id" | "shuffle";
  seed: number;
  page: number;
  pageSize: 10 | 25 | 50 | 100;
  active?: string;
  notice?: string;
};
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const column = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9_-]{1,32})$/;
const active = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9_-]{1,32}):([1-9]\d*)$/;
const pageSizes = new Set([10,25,50,100]);
export function tupleParts(value: string) {
  const match = column.exec(value);
  return match ? { modelId: match[1]!, stepId: match[2]!, instanceId: match[3]! } : undefined;
}
export function activeParts(value?: string) {
  const match = value ? active.exec(value) : null;
  return match ? { key: `${match[1]}:${match[2]}:${match[3]}`, sampleIndex: Number(match[4]) } : undefined;
}
export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const rawColumns = (params.get("cols") ?? "").split(",").filter(Boolean);
  const columns = [...new Set(rawColumns.filter((value) => column.test(value)))];
  const rawSeed = Number(params.get("seed")); const rawPage = Number(params.get("page")); const rawSize = Number(params.get("pageSize"));
  const datasetId = params.get("dataset") ?? undefined; const rawActive = params.get("active") ?? undefined;
  const requestedMode = params.get("mode");
  return {
    ...(datasetId && id.test(datasetId) ? { datasetId } : {}),
    mode: requestedMode === "steps" || requestedMode === "models" ? requestedMode : "gallery",
    columns, query: params.get("q") ?? "", order: params.get("order") === "shuffle" ? "shuffle" : "id",
    seed: Number.isInteger(rawSeed) && rawSeed >= 0 && rawSeed <= 0xffffffff ? rawSeed : 0,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: (pageSizes.has(rawSize) ? rawSize : 25) as ViewState["pageSize"],
    ...(rawActive && active.test(rawActive) ? { active: rawActive } : {}),
    ...(requestedMode && !["gallery","steps","models"].includes(requestedMode) ? { notice: "Unknown mode; Gallery is shown." } : {})
  };
}
export function serializeViewState(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.datasetId) params.set("dataset",state.datasetId);
  if (state.mode !== "gallery") params.set("mode",state.mode);
  if (state.columns.length) params.set("cols",state.columns.join(","));
  if (state.query) params.set("q",state.query);
  if (state.order === "shuffle") { params.set("order","shuffle"); params.set("seed",String(state.seed >>> 0)); }
  if (state.page !== 1) params.set("page",String(state.page));
  if (state.pageSize !== 25) params.set("pageSize",String(state.pageSize));
  if (state.active) params.set("active",state.active);
  const encoded = params.toString(); return encoded ? `?${encoded}` : "";
}
