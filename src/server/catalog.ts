import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { imageSize } from "image-size";
import {
  type CatalogResponse,
  type DatasetResponse,
  type Diagnostic,
  type ImageDescriptor,
  type ManifestV2,
  type RecordV2,
  idPattern,
  manifestSchema,
  recordSchema
} from "../shared/contracts.js";

const limits = {
  datasetsLimit: 100,
  models: 200,
  pairs: 1000,
  setBytes: 100 * 1024 * 1024,
  records: 100_000,
  imageBytes: 50 * 1024 * 1024,
  recordBytes: 1024 * 1024,
  // Portable BaseModel executions include the exact loader plan, tensors and
  // source annotation. The largest measured record has 18,578 JSON nodes.
  recordNodes: 25_000,
  depth: 100
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateManifest = ajv.compile<ManifestV2>(manifestSchema);
const validateRecord = ajv.compile<RecordV2>(recordSchema);
const idRegex = new RegExp(idPattern);

type EvalEntry = {
  dir: string;
  manifest: ManifestV2;
  fingerprint: string;
};

type DatasetCache = {
  fingerprint: string;
  response: DatasetResponse;
  imageFiles: Map<number, string>;
};

function issueMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function errorDiagnostic(
  code: Diagnostic["code"],
  message: string,
  extra: Omit<Diagnostic, "severity" | "code" | "message"> = {}
): Diagnostic {
  return { severity: "error", code, message, ...extra };
}

function hashParts(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20);
}

async function safeFile(root: string, segments: string[]): Promise<string> {
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const lst = await lstat(cursor);
    if (lst.isSymbolicLink()) throw new Error("symbolic links are not allowed");
    const info = await stat(cursor, { bigint: false });
    if (!info.isFile() && !info.isDirectory()) throw new Error("path type is not supported");
  }
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(cursor);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("path escapes the data root");
  }
  return canonical;
}

function inspectJson(value: unknown): { nodes: number; depth: number } {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  let nodes = 0;
  let maxDepth = 1;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    if (nodes > limits.recordNodes || maxDepth > limits.depth) break;
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (current.value && typeof current.value === "object") {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return { nodes, depth: maxDepth };
}

async function readHeader(file: string, bytes = 1024 * 1024): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function mediaType(buffer: Buffer, extension: string): ImageDescriptor["media_type"] | undefined {
  const hex = buffer.subarray(0, 12).toString("hex");
  if (extension === ".png" && hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if ((extension === ".jpg" || extension === ".jpeg") && hex.startsWith("ffd8ff")) return "image/jpeg";
  if (extension === ".webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

export class CatalogStore {
  readonly root: string;
  private entries = new Map<string, EvalEntry>();
  private catalogDiagnostics: Diagnostic[] = [];
  private snapshotId = "empty";
  private checkedAt = 0;
  private rootFingerprint = "";
  private datasets = new Map<string, DatasetCache>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async initialize(): Promise<void> {
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error("the data root must not be a symbolic link");
    await this.reload(true);
  }

  private async manifestDirectories(): Promise<string[]> {
    const children = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    const names: string[] = [];
    for (const child of children) {
      try {
        await lstat(path.join(this.root, child.name, "manifest.json"));
        names.push(child.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") names.push(child.name);
      }
    }
    return names;
  }

  private async fingerprintRoot(): Promise<string> {
    const pieces: string[] = [];
    for (const name of await this.manifestDirectories()) {
      try {
        const manifest = await safeFile(this.root, [name, "manifest.json"]);
        const info = await stat(manifest);
        pieces.push(`${name}:${info.size}:${info.mtimeMs}`);
      } catch {
        pieces.push(`${name}:invalid`);
      }
    }
    return hashParts(...pieces);
  }

  async ensureFresh(): Promise<void> {
    if (Date.now() - this.checkedAt < 500) return;
    this.checkedAt = Date.now();
    const next = await this.fingerprintRoot();
    if (next !== this.rootFingerprint) await this.reload(false);
  }

  async reload(forceDatasets: boolean): Promise<CatalogResponse> {
    await stat(this.root);
    const children = await this.manifestDirectories();
    const diagnostics: Diagnostic[] = [];
    const next = new Map<string, EvalEntry>();
    if (children.length > limits.datasetsLimit) {
      diagnostics.push(errorDiagnostic("RESOURCE_LIMIT_EXCEEDED", `Data root contains ${children.length} evaluation sets; maximum is ${limits.datasetsLimit}.`));
    }
    for (const child of children.slice(0, limits.datasetsLimit)) {
      const old = this.entries.get(child);
      try {
        if (!idRegex.test(child)) throw new Error("directory ID does not match the required identifier pattern");
        const manifestPath = await safeFile(this.root, [child, "manifest.json"]);
        const manifestInfo = await stat(manifestPath);
        if (manifestInfo.size > 1024 * 1024) throw new Error("manifest exceeds 1 MiB");
        const source = await readFile(manifestPath, "utf8");
        const parsed: unknown = JSON.parse(source);
        if (parsed && typeof parsed === "object") {
          const versions = parsed as { schema_version?: unknown; record_schema_version?: unknown };
          if (versions.schema_version !== 2 || versions.record_schema_version !== 2) {
            throw Object.assign(new Error("only manifest and record schema version 2 are supported"), { diagnosticCode: "UNSUPPORTED_SCHEMA_VERSION" as const });
          }
        }
        if (!validateManifest(parsed)) throw new Error(issueMessage(validateManifest.errors));
        const manifest = parsed as ManifestV2;
        if (manifest.id !== child) throw new Error(`manifest id must equal directory name ${child}`);
        const modelIds = new Set<string>();
        let pairs = 0;
        for (const model of manifest.models) {
          if (modelIds.has(model.id)) throw new Error(`duplicate model id ${model.id}`);
          modelIds.add(model.id);
          const stepIds = new Set<string>();
          for (const step of model.steps) {
            if (stepIds.has(step.id)) throw new Error(`duplicate step id ${step.id}`);
            stepIds.add(step.id);
            if (step.status === "complete" && step.record_count !== 30) throw new Error(`complete pair ${step.id} must have 30 records`);
            if (step.status !== "complete" && !step.shortfall_reason) throw new Error(`incomplete pair ${step.id} needs a shortfall reason`);
            if (step.status === "blocked" && step.record_count !== 0) throw new Error(`blocked pair ${step.id} must have zero records`);
          }
          pairs += model.steps.length;
        }
        if (manifest.models.length > limits.models || pairs > limits.pairs) throw new Error("manifest exceeds model or model/step limits");
        next.set(child, {
          dir: child,
          manifest,
          fingerprint: hashParts(source, manifestInfo.mtimeMs)
        });
      } catch (error) {
        const code = (error as { diagnosticCode?: Diagnostic["code"] }).diagnosticCode ?? "MANIFEST_INVALID";
        diagnostics.push(errorDiagnostic(code, `Invalid manifest: ${error instanceof Error ? error.message : String(error)}`, {
          dataset_id: child,
          public_path: `${child}/manifest.json`
        }));
        if (old) {
          next.set(child, old);
          diagnostics.push(errorDiagnostic("STALE_SNAPSHOT", "The last valid manifest snapshot remains active.", { dataset_id: child }));
        }
      }
    }
    this.entries = next;
    this.catalogDiagnostics = diagnostics;
    this.rootFingerprint = await this.fingerprintRoot();
    this.snapshotId = hashParts(this.rootFingerprint, ...[...next.values()].map((entry) => entry.fingerprint));
    if (forceDatasets) {
      for (const key of [...this.datasets.keys()]) {
        const [evalId, modelId, stepText] = key.split("\0");
        if (evalId && modelId && stepText) await this.getDataset(evalId, modelId, stepText, true).catch(() => undefined);
      }
    }
    return this.catalog();
  }

  catalog(): CatalogResponse {
    return {
      snapshot_id: this.snapshotId,
      datasets: [...this.entries.values()].map(({ manifest }) => ({
        id: manifest.id,
        title: manifest.title,
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
        record_schema_version: manifest.record_schema_version,
        models: manifest.models.map((model) => ({ ...model, steps: [...model.steps] }))
      })),
      diagnostics: this.catalogDiagnostics
    };
  }

  private resolveTuple(evalId: string, modelId: string, step: string): EvalEntry {
    if (!idRegex.test(evalId) || !idRegex.test(modelId) || !idRegex.test(step)) {
      throw new Error("invalid evaluation-set, model, or step identifier");
    }
    const entry = this.entries.get(evalId);
    const model = entry?.manifest.models.find((candidate) => candidate.id === modelId);
    if (!entry || !model?.steps.some((candidate) => candidate.id === step)) throw new Error("model/step is not declared by the active manifest");
    return entry;
  }

  async getDataset(evalId: string, modelId: string, step: string, force = false): Promise<DatasetResponse> {
    const entry = this.resolveTuple(evalId, modelId, step);
    const key = `${evalId}\0${modelId}\0${step}`;
    const previous = this.datasets.get(key);
    try {
      const setPath = await safeFile(this.root, [evalId, modelId, step, "set.json"]);
      const info = await stat(setPath);
      if (info.size > limits.setBytes) throw new Error(`set.json exceeds ${limits.setBytes} bytes`);
      const fingerprint = hashParts(entry.fingerprint, info.size, info.mtimeMs);
      if (!force && previous?.fingerprint === fingerprint) return previous.response;
      const source = await readFile(setPath, "utf8");
      const parsed: unknown = JSON.parse(source);
      if (!Array.isArray(parsed)) throw new Error("set.json must be a JSON array");
      if (parsed.length > limits.records) throw new Error(`set.json exceeds ${limits.records} records`);
      const diagnostics: Diagnostic[] = [];
      const records: RecordV2[] = [];
      const declaredStep = entry.manifest.models.find((model) => model.id === modelId)?.steps.find((candidate) => candidate.id === step);
      if (!declaredStep) throw new Error("undeclared step");
      if (parsed.length !== declaredStep.record_count) throw Object.assign(new Error(`declared ${declaredStep.record_count} records but found ${parsed.length}`), { apiCode: "COUNT_MISMATCH" });
      const seen = new Map<number, number>();
      let duplicate = false;
      parsed.forEach((candidate, index) => {
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          const sampleIndex = (candidate as { sample_index?: unknown }).sample_index;
          if (Number.isSafeInteger(sampleIndex) && Number(sampleIndex) >= 1) {
            const id = Number(sampleIndex);
            if (seen.has(id)) {
              duplicate = true;
              diagnostics.push(errorDiagnostic("DUPLICATE_SAMPLE_INDEX", `Sample index ${id} occurs more than once.`, {
                dataset_id: evalId, model_id: modelId, step_id: step, record_index: index, sample_index: id,
                public_path: `${evalId}/${modelId}/${step}/set.json`
              }));
            } else seen.set(id, index);
          }
        }
        const shape = inspectJson(candidate);
        const encodedBytes = Buffer.byteLength(JSON.stringify(candidate));
        if (shape.depth > limits.depth || shape.nodes > limits.recordNodes || encodedBytes > limits.recordBytes) {
          diagnostics.push(errorDiagnostic("RESOURCE_LIMIT_EXCEEDED", `Record ${index} exceeds nesting, item, or byte limits.`, {
            dataset_id: evalId, model_id: modelId, step_id: step, record_index: index
          }));
          return;
        }
        if (!validateRecord(candidate)) {
          diagnostics.push(errorDiagnostic("RECORD_INVALID", `Invalid record: ${issueMessage(validateRecord.errors)}`, {
            dataset_id: evalId, model_id: modelId, step_id: step, record_index: index,
            public_path: `${evalId}/${modelId}/${step}/set.json`
          }));
          return;
        }
        if (candidate.review_stage !== declaredStep.review_stage) {
          diagnostics.push(errorDiagnostic("RECORD_INVALID", `Record ${index} review stage differs from manifest.`, { dataset_id: evalId, model_id: modelId, step_id: step, record_index: index }));
          return;
        }
        records.push(candidate);
      });
      if (duplicate) throw Object.assign(new Error("duplicate sample indices make the dataset ambiguous"), { diagnostics });
      if (records.length !== parsed.length || records.some((record, index) => record.sample_index !== index + 1)) {
        throw Object.assign(new Error("records must be valid with contiguous sample_index 1..N"), { apiCode: "RECORD_INVALID", diagnostics });
      }

      const images: Record<string, ImageDescriptor> = Object.create(null) as Record<string, ImageDescriptor>;
      const imageFiles = new Map<number, string>();
      for (const record of records) {
        const result = await this.inspectImage(evalId, modelId, step, record.sample_index);
        images[String(record.sample_index)] = result.descriptor;
        if (result.file) imageFiles.set(record.sample_index, result.file);
        diagnostics.push(...result.diagnostics);
      }
      const response: DatasetResponse = {
        dataset_id: evalId,
        model_id: modelId,
        step_id: step,
        snapshot_id: hashParts(fingerprint, records.length, diagnostics.length),
        records,
        images,
        diagnostics
      };
      this.datasets.set(key, { fingerprint, response, imageFiles });
      return response;
    } catch (error) {
      if (previous) {
        return {
          ...previous.response,
          diagnostics: [
            ...previous.response.diagnostics,
            ...((error as { diagnostics?: Diagnostic[] }).diagnostics ?? []),
            errorDiagnostic("STALE_SNAPSHOT", `The changed dataset is invalid; the last valid snapshot remains active: ${error instanceof Error ? error.message : String(error)}`, {
              dataset_id: evalId, model_id: modelId, step_id: step
            })
          ]
        };
      }
      const failure = error as Error & { apiCode?: string; diagnostics?: Diagnostic[] };
      if (!failure.apiCode) {
        failure.apiCode = failure.diagnostics?.some((item) => item.code === "DUPLICATE_SAMPLE_INDEX")
          ? "DUPLICATE_SAMPLE_INDEX"
          : failure.message.includes("exceeds")
            ? "RESOURCE_LIMIT_EXCEEDED"
            : "SET_JSON_INVALID";
      }
      throw failure;
    }
  }

  private async inspectImage(evalId: string, modelId: string, step: string, sampleIndex: number): Promise<{
    descriptor: ImageDescriptor;
    diagnostics: Diagnostic[];
    file?: string;
  }> {
    const base = [evalId, modelId, step];
    const candidates = ["webp", "png", "jpg", "jpeg"];
    const found: Array<{ name: string; file: string }> = [];
    for (const extension of candidates) {
      const name = `sample-${sampleIndex}.${extension}`;
      try {
        const file = await safeFile(this.root, [...base, name]);
        const info = await stat(file);
        if (info.isFile()) found.push({ name, file });
      } catch {
        // A missing candidate is expected while checking precedence.
      }
    }
    const context = { dataset_id: evalId, model_id: modelId, step_id: step, sample_index: sampleIndex };
    if (!found.length) {
      return {
        descriptor: { status: "missing", file_name: `sample-${sampleIndex}.png` },
        diagnostics: [errorDiagnostic("IMAGE_MISSING", `No supported image exists for sample ${sampleIndex}.`, {
          ...context, public_path: `${base.join("/")}/p${sampleIndex}.webp`
        })]
      };
    }
    const chosen = found[0];
    if (!chosen) throw new Error("image precedence resolution failed");
    const diagnostics: Diagnostic[] = [];
    if (found.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "IMAGE_AMBIGUOUS",
        message: `Multiple images exist; ${chosen.name} wins by format precedence.`,
        ...context,
        public_path: `${base.join("/")}/${chosen.name}`
      });
    }
    try {
      const info = await stat(chosen.file);
      if (info.size > limits.imageBytes) throw new Error(`image exceeds ${limits.imageBytes} bytes`);
      const header = await readHeader(chosen.file);
      const extension = path.extname(chosen.name).toLowerCase();
      const type = mediaType(header, extension);
      if (!type) throw new Error("file signature does not match its supported extension");
      const dimensions = imageSize(header);
      if (!dimensions.width || !dimensions.height) throw new Error("image dimensions are unavailable");
      const url = `/api/v2/images/${encodeURIComponent(evalId)}/${encodeURIComponent(modelId)}/${encodeURIComponent(step)}/${sampleIndex}`;
      return {
        descriptor: {
          status: found.length > 1 ? "ambiguous" : "available",
          url,
          media_type: type,
          file_name: chosen.name,
          width: dimensions.width,
          height: dimensions.height
        },
        diagnostics,
        file: chosen.file
      };
    } catch (error) {
      diagnostics.push(errorDiagnostic("IMAGE_DECODE_FAILED", `Image cannot be decoded safely: ${error instanceof Error ? error.message : String(error)}`, {
        ...context, public_path: `${base.join("/")}/${chosen.name}`
      }));
      return { descriptor: { status: "invalid", file_name: chosen.name }, diagnostics };
    }
  }

  async getImage(evalId: string, modelId: string, step: string, sampleIndex: number): Promise<{ file: string; descriptor: ImageDescriptor }> {
    if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 1 || sampleIndex > 30) throw new Error("invalid sample index");
    const response = await this.getDataset(evalId, modelId, step);
    if (!response.records.some((record) => record.sample_index === sampleIndex)) throw new Error("sample is not declared");
    // Revalidate on every media request; a file may have changed after a cached set was read.
    const current = await this.inspectImage(evalId, modelId, step, sampleIndex);
    if (!current.file || !current.descriptor.media_type) throw new Error("image is unavailable");
    return { file: current.file, descriptor: current.descriptor };
  }
}
