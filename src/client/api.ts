import type { ApiError, CatalogResponse, DatasetResponse } from "../shared/contracts.js";
async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init); const body = (await response.json()) as T | ApiError;
  if (!response.ok) throw new Error("error" in (body as object) ? (body as ApiError).error.message : `Request failed with status ${response.status}`);
  return body as T;
}
export const api = {
  catalog: (signal?: AbortSignal) => json<CatalogResponse>("/api/v2/catalog", { signal }),
  dataset: (datasetId: string, modelId: string, stepId: string, signal?: AbortSignal) =>
    json<DatasetResponse>(`/api/v2/datasets/${encodeURIComponent(datasetId)}/${encodeURIComponent(modelId)}/${encodeURIComponent(stepId)}`, { signal }),
  reload: () => json<CatalogResponse>("/api/v2/reload", { method: "POST" })
};
