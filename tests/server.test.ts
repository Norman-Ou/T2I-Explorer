import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server/app.js";
import type { CatalogResponse, DatasetResponse } from "../src/shared/contracts.js";

const fixtureRoot = path.resolve("fixtures/eval-sets");
const apps: FastifyInstance[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function app(root = fixtureRoot) {
  const instance = await buildApp({ dataRoot: root, serveClient: false });
  apps.push(instance);
  return instance;
}

async function miniRoot(records: unknown[], schemaVersion = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), "t2i-explorer-mini-"));
  const step = path.join(root, "mini/models/model/s1");
  await mkdir(step, { recursive: true });
  await writeFile(path.join(root, "mini/manifest.json"), JSON.stringify({
    schema_version: schemaVersion,
    record_schema_version: 1,
    id: "mini",
    title: "Mini",
    models: [{ id: "model", label: "Model", steps: [1] }]
  }));
  await writeFile(path.join(step, "set.json"), JSON.stringify(records));
  return root;
}

describe("read-only API", () => {
  it("discovers valid manifests and returns model-owned records and image diagnostics", async () => {
    const instance = await app();
    const catalogResponse = await instance.inject({ method: "GET", url: "/api/v1/catalog", headers: { host: "127.0.0.1" } });
    expect(catalogResponse.statusCode).toBe(200);
    const catalog = catalogResponse.json<CatalogResponse>();
    expect(catalog.eval_sets[0]?.id).toBe("sample-eval");
    const notModified = await instance.inject({ method: "GET", url: "/api/v1/catalog", headers: { host: "127.0.0.1", "if-none-match": catalogResponse.headers.etag! } });
    expect(notModified.statusCode).toBe(304);

    const response = await instance.inject({ method: "GET", url: "/api/v1/eval-sets/sample-eval/models/model-b/steps/2000", headers: { host: "localhost" } });
    expect(response.statusCode).toBe(200);
    const data = response.json<DatasetResponse>();
    expect(data.records.find((record) => record.prompt_id === 1)?.prompt).toBe("A scarlet geometric tile");
    expect(data.images["1"]?.status).toBe("ambiguous");
    expect(data.images["4"]?.status).toBe("missing");
    expect(data.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["IMAGE_AMBIGUOUS", "IMAGE_MISSING"]));
  });

  it("serves only validated image tuples with nosniff and an allowlisted media type", async () => {
    const instance = await app();
    const response = await instance.inject({ method: "GET", url: "/api/v1/images/sample-eval/model-a/1000/2", headers: { host: "127.0.0.1" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const traversal = await instance.inject({ method: "GET", url: "/api/v1/images/..%2Fsecret/model-a/1000/2", headers: { host: "127.0.0.1" } });
    expect(traversal.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("retains the last valid dataset snapshot after a malformed reload", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "t2i-explorer-"));
    await cp(fixtureRoot, temporary, { recursive: true });
    const instance = await app(temporary);
    const url = "/api/v1/eval-sets/sample-eval/models/model-a/steps/1000";
    expect((await instance.inject({ method: "GET", url, headers: { host: "localhost" } })).statusCode).toBe(200);
    const setFile = path.join(temporary, "sample-eval/models/model-a/s1000/set.json");
    await writeFile(setFile, "{not json", "utf8");
    expect((await instance.inject({ method: "POST", url: "/api/v1/reload", headers: { host: "localhost", origin: "http://localhost" } })).statusCode).toBe(200);
    const stale = (await instance.inject({ method: "GET", url, headers: { host: "localhost" } })).json<DatasetResponse>();
    expect(stale.records).toHaveLength(3);
    expect(stale.diagnostics.some((item) => item.code === "STALE_SNAPSHOT")).toBe(true);
  });

  it("rejects symlinked dataset files", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "t2i-explorer-link-"));
    await cp(fixtureRoot, temporary, { recursive: true });
    const setFile = path.join(temporary, "sample-eval/models/model-a/s1000/set.json");
    const source = await readFile(setFile);
    const outside = path.join(temporary, "outside.json");
    await writeFile(outside, source);
    await import("node:fs/promises").then(({ unlink }) => unlink(setFile));
    await symlink(outside, setFile);
    const instance = await app(temporary);
    const response = await instance.inject({ method: "GET", url: "/api/v1/eval-sets/sample-eval/models/model-a/steps/1000", headers: { host: "localhost" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toMatch(/symbolic links/i);
  });

  it("retains valid records while surfacing malformed records", async () => {
    const root = await miniRoot([
      { prompt_id: 1, prompt: "valid", prompt_output: "valid" },
      { prompt_id: 2, prompt: 4, prompt_output: "invalid" }
    ]);
    const instance = await app(root);
    const response = await instance.inject({ method: "GET", url: "/api/v1/eval-sets/mini/models/model/steps/1", headers: { host: "localhost" } });
    const data = response.json<DatasetResponse>();
    expect(response.statusCode).toBe(200);
    expect(data.records.map((record) => record.prompt_id)).toEqual([1]);
    expect(data.diagnostics.some((item) => item.code === "RECORD_INVALID" && item.record_index === 1)).toBe(true);
  });

  it("rejects duplicate IDs and reports unsupported manifest versions", async () => {
    const duplicateRoot = await miniRoot([
      { prompt_id: 1, prompt: "one", prompt_output: "one" },
      { prompt_id: 1, prompt: "duplicate", prompt_output: "duplicate" }
    ]);
    const duplicateApp = await app(duplicateRoot);
    const duplicate = await duplicateApp.inject({ method: "GET", url: "/api/v1/eval-sets/mini/models/model/steps/1", headers: { host: "localhost" } });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json().error.code).toBe("DUPLICATE_PROMPT_ID");
    expect(duplicate.json().error.message).toMatch(/duplicate prompt IDs/i);

    const unsupportedRoot = await miniRoot([], 2);
    const unsupportedApp = await app(unsupportedRoot);
    const catalog = (await unsupportedApp.inject({ method: "GET", url: "/api/v1/catalog", headers: { host: "localhost" } })).json<CatalogResponse>();
    expect(catalog.eval_sets).toHaveLength(0);
    expect(catalog.diagnostics.some((item) => item.code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("marks a supported extension with invalid bytes as an invalid image", async () => {
    const root = await miniRoot([{ prompt_id: 1, prompt: "one", prompt_output: "one" }]);
    await writeFile(path.join(root, "mini/models/model/s1/p1.webp"), "not a webp");
    const instance = await app(root);
    const response = await instance.inject({ method: "GET", url: "/api/v1/eval-sets/mini/models/model/steps/1", headers: { host: "localhost" } });
    const data = response.json<DatasetResponse>();
    expect(data.images["1"]?.status).toBe("invalid");
    expect(data.diagnostics.some((item) => item.code === "IMAGE_DECODE_FAILED")).toBe(true);
  });
});
