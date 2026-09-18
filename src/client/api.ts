import type { ApiError, CatalogResponse, DatasetResponse } from "../shared/contracts.js";

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) {
    const message = "error" in (body as object) ? (body as ApiError).error.message : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  catalog: (signal?: AbortSignal) => json<CatalogResponse>("/api/v1/catalog", { signal }),
  dataset: (evalId: string, modelId: string, step: number, signal?: AbortSignal) =>
    json<DatasetResponse>(`/api/v1/eval-sets/${encodeURIComponent(evalId)}/models/${encodeURIComponent(modelId)}/steps/${step}`, { signal }),
  reload: () => json<CatalogResponse>("/api/v1/reload", { method: "POST" })
};
