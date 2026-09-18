export type ViewState = {
  evalId?: string;
  view: "models";
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
const column = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):(\d+)$/;
const active = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):(\d+):(\d+)$/;
const pageSizes = new Set([10, 25, 50, 100]);

export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  const rawColumns = (params.get("cols") ?? "").split(",").filter(Boolean);
  const columns = [...new Set(rawColumns.filter((value) => {
    const match = column.exec(value);
    return Boolean(match && Number(match[2]) <= 2147483647);
  }))];
  const rawSeed = Number(params.get("seed"));
  const rawPage = Number(params.get("page"));
  const rawSize = Number(params.get("pageSize"));
  const evalId = params.get("eval") ?? undefined;
  const rawActive = params.get("active") ?? undefined;
  const activeMatch = rawActive ? active.exec(rawActive) : null;
  const validActive = Boolean(activeMatch && Number(activeMatch[2]) <= 2147483647 && Number.isSafeInteger(Number(activeMatch[3])));
  const order = params.get("order") === "shuffle" ? "shuffle" : "id";
  return {
    ...(evalId && id.test(evalId) ? { evalId } : {}),
    view: "models",
    columns,
    query: params.get("q") ?? "",
    order,
    seed: Number.isInteger(rawSeed) && rawSeed >= 0 && rawSeed <= 0xffffffff ? rawSeed : 0,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: (pageSizes.has(rawSize) ? rawSize : 25) as ViewState["pageSize"],
    ...(rawActive && validActive ? { active: rawActive } : {}),
    ...(requestedView && requestedView !== "models" ? { notice: `${requestedView} view is not available yet; Models is shown.` } : {})
  };
}

export function serializeViewState(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.evalId) params.set("eval", state.evalId);
  if (state.columns.length) params.set("cols", state.columns.join(","));
  if (state.query) params.set("q", state.query);
  if (state.order === "shuffle") {
    params.set("order", "shuffle");
    params.set("seed", String(state.seed >>> 0));
  }
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
  if (state.active) params.set("active", state.active);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function tupleParts(value: string): { modelId: string; step: number } | undefined {
  const match = column.exec(value);
  return match ? { modelId: match[1] ?? "", step: Number(match[2]) } : undefined;
}

export function activeParts(value?: string): { modelId: string; step: number; promptId: number } | undefined {
  if (!value) return undefined;
  const match = active.exec(value);
  return match ? { modelId: match[1] ?? "", step: Number(match[2]), promptId: Number(match[3]) } : undefined;
}
