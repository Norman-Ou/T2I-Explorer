import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { CatalogStore } from "./catalog.js";
import { MediaStore, MediaError, type OpenMedia } from "./media.js";
function apiError(reply: FastifyReply, status: number, code: string, message: string, requestId: string) {
    return reply.code(status).send({ error: { code, message, request_id: requestId } });
}
function sendJsonWithEtag(request: {
    headers: {
        [key: string]: unknown;
    };
}, reply: FastifyReply, etagValue: string, body: unknown) {
    const etag = `"${etagValue}"`;
    if (request.headers["if-none-match"] === etag)
        return reply.code(304).header("ETag", etag).send();
    return reply.header("Cache-Control", "no-cache").header("ETag", etag).send(body);
}
export async function buildApp(options: {
    dataRoot: string;
    serveClient?: boolean;
    allowedHosts?: string[];
}) {
    const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.url"] }, genReqId: () => randomUUID() });
    const catalog = new CatalogStore(options.dataRoot);
    const media = new MediaStore();
    const allowedHosts = new Set(options.allowedHosts ?? ["127.0.0.1", "localhost"]);
    await catalog.initialize();
    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "blob:"],
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
    app.get("/api/health", async () => ({ status: "ok" }));
    app.get("/api/catalog", async (request, reply) => {
        catalog.ensureFresh();
        const data = catalog.catalog();
        return sendJsonWithEtag(request, reply, data.snapshot_id, data);
    });
    app.get<{
        Params: {
            collection: string;
            task: string;
            dataset: string;
            exp: string;
        };
    }>("/api/collections/:collection/tasks/:task/datasets/:dataset/exps/:exp/records", async (request, reply) => {
        try {
            catalog.ensureFresh();
            const p = request.params;
            const data = await catalog.getExperiment(p.collection, p.task, p.dataset, p.exp);
            return sendJsonWithEtag(request, reply, data.snapshot_id, data);
        }
        catch {
            return apiError(reply, 422, "EXPERIMENT_UNAVAILABLE", "The declared experiment is unavailable.", request.id);
        }
    });
    app.get<{
        Params: {
            collection: string;
            task: string;
            dataset: string;
            exp: string;
            sample: string;
            panel: string;
        };
        Querystring: { variant?: string };
    }>("/api/media/:collection/:task/:dataset/:exp/:sample/:panel", async (request, reply) => {
        if (request.query.variant !== undefined && request.query.variant !== 'thumbnail')
            return apiError(reply, 400, 'INVALID_VARIANT', 'Unknown image variant.', request.id);
        let image: OpenMedia | undefined;
        let streamed = false;
        try {
            const p = request.params;
            const declared = await catalog.getPanel(p.collection, p.task, p.dataset, p.exp, p.sample, p.panel);
            image = await media.open(declared.root, declared.asset);
            const thumbnail = request.query.variant === 'thumbnail';
            const etag = thumbnail ? media.thumbnailEtag(image) : image.etag;
            reply.header('Cache-Control', 'private, no-cache').header('ETag', etag);
            if (request.headers['if-none-match'] === etag)
                return reply.code(304).send();
            if (thumbnail) return reply.type('image/webp').send(await media.thumbnail(image));
            const stream = image.handle.createReadStream({ start: 0 });
            streamed = true;
            return reply.type(image.mediaType).send(stream);
        }
        catch (error) {
            reply.removeHeader('ETag');
            reply.header('Cache-Control', 'no-store');
            if (error instanceof MediaError) return apiError(reply, error.status, error.code, error.message, request.id);
            return apiError(reply, 404, 'PANEL_UNAVAILABLE', 'The declared panel is unavailable.', request.id);
        }
        finally { if (!streamed) await image?.handle.close(); }
    });
    app.post("/api/reload", { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        if (request.headers.origin) {
            try {
                const origin = new URL(request.headers.origin);
                if (!allowedHosts.has(origin.hostname) || origin.host !== request.headers.host)
                    throw new Error('Origin mismatch');
            }
            catch {
                return apiError(reply, 403, "ORIGIN_NOT_ALLOWED", "Reload requires a same-origin request.", request.id);
            }
        }
        return reply.header('Cache-Control', 'no-store').send(await catalog.reload(true));
    });
    if (options.serveClient !== false) {
        const serverDir = path.dirname(fileURLToPath(import.meta.url));
        const clientRoot = path.resolve(serverDir, "../../dist");
        await app.register(staticPlugin, { root: clientRoot, wildcard: false });
    }
    app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/') || options.serveClient === false)
            return apiError(reply, 404, 'NOT_FOUND', 'API route not found.', request.id);
        return reply.type('text/html').sendFile('index.html');
    });
    app.setErrorHandler((error, request, reply) => {
        request.log.error({ err: error, route: request.routeOptions.url }, "request failed");
        return apiError(reply, 500, "INTERNAL_ERROR", "The request could not be completed.", request.id);
    });
    return app;
}
