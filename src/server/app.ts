import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { CatalogStore } from "./catalog.js";

type TupleParams = { dataset: string; model: string; step: string };
type ImageParams = TupleParams & { sampleIndex: string };

function apiError(reply: FastifyReply, status: number, code: string, message: string, requestId: string) {
  return reply.code(status).send({ error: { code, message, request_id: requestId } });
}

function parseInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sendJsonWithEtag(request: { headers: { [key: string]: unknown } }, reply: FastifyReply, etagValue: string, body: unknown) {
  const etag = `"${etagValue}"`;
  if (request.headers["if-none-match"] === etag) return reply.code(304).header("ETag", etag).send();
  return reply.header("Cache-Control", "no-cache").header("ETag", etag).send(body);
}

export async function buildApp(options: { dataRoot: string; serveClient?: boolean; allowedHosts?: string[] }) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.url"] }, genReqId: () => randomUUID() });
  const catalog = new CatalogStore(options.dataRoot);
  const allowedHosts = new Set(options.allowedHosts ?? ["127.0.0.1", "localhost"]);
  await catalog.initialize();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        // The default deployment is plain HTTP on loopback. Safari/WebKit
        // otherwise upgrades same-origin assets to HTTPS and leaves the app
        // shell blank.
        upgradeInsecureRequests: null
      }
    },
    strictTransportSecurity: false,
    referrerPolicy: { policy: "no-referrer" }
  });
  await app.register(rateLimit, { global: false });

  app.addHook("onRequest", async (request, reply) => {
    const host = request.hostname;
    if (!allowedHosts.has(host)) {
      return apiError(reply, 403, "HOST_NOT_ALLOWED", "The request host is not allowlisted.", request.id);
    }
  });

  app.get("/api/v2/health", async () => ({ status: "ok" }));

  app.get("/api/v2/catalog", async (request, reply) => {
    await catalog.ensureFresh();
    const response = catalog.catalog();
    return sendJsonWithEtag(request, reply, response.snapshot_id, response);
  });

  app.get<{ Params: TupleParams }>("/api/v2/datasets/:dataset/:model/:step", async (request, reply) => {
    try {
      await catalog.ensureFresh();
      const dataset = await catalog.getDataset(request.params.dataset, request.params.model, request.params.step);
      return sendJsonWithEtag(request, reply, dataset.snapshot_id, dataset);
    } catch (error) {
      const code = (error as { apiCode?: string }).apiCode ?? "DATASET_UNAVAILABLE";
      return apiError(reply, 422, code, error instanceof Error ? error.message : "Dataset is unavailable.", request.id);
    }
  });

  app.get<{ Params: ImageParams }>("/api/v2/images/:dataset/:model/:step/:sampleIndex", async (request, reply) => {
    const sampleIndex = parseInteger(request.params.sampleIndex);
    if (sampleIndex === undefined || sampleIndex < 1 || sampleIndex > 30) return apiError(reply, 400, "INVALID_IMAGE_TUPLE", "Sample index must be 1..30.", request.id);
    try {
      const image = await catalog.getImage(request.params.dataset, request.params.model, request.params.step, sampleIndex);
      const info = await stat(image.file);
      const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      if (request.headers["if-none-match"] === etag) return reply.code(304).header("ETag", etag).send();
      return reply
        .header("Content-Type", image.descriptor.media_type)
        .header("Cache-Control", "private, max-age=60, must-revalidate")
        .header("ETag", etag)
        .header("Content-Disposition", `inline; filename="${image.descriptor.file_name ?? "image"}"`)
        .send(createReadStream(image.file));
    } catch (error) {
      return apiError(reply, 404, "IMAGE_UNAVAILABLE", error instanceof Error ? error.message : "Image is unavailable.", request.id);
    }
  });

  app.post("/api/v2/reload", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if ((parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") || parsed.host !== request.headers.host) {
          return apiError(reply, 403, "ORIGIN_NOT_ALLOWED", "Reload requires a same-origin request.", request.id);
        }
      } catch {
        return apiError(reply, 403, "ORIGIN_NOT_ALLOWED", "Reload requires a valid same-origin request.", request.id);
      }
    }
    const result = await catalog.reload(true);
    return reply.header("Cache-Control", "no-store").send(result);
  });

  if (options.serveClient !== false) {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const clientRoot = path.resolve(serverDir, "../../dist");
    await app.register(staticPlugin, { root: clientRoot, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) return apiError(reply, 404, "NOT_FOUND", "API route not found.", request.id);
      return reply.type("text/html").sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, route: request.routeOptions.url }, "request failed");
    return apiError(reply, 500, "INTERNAL_ERROR", "The request could not be completed.", request.id);
  });

  return app;
}
