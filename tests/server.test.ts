import { copyFile, cp, mkdir, mkdtemp, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server/app.js";
import type { CatalogResponse, DatasetResponse } from "../src/shared/contracts.js";
const fixtureRoot = path.resolve("fixtures/datasets"); const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function app(root = fixtureRoot) { const instance = await buildApp({ dataRoot: root, serveClient: false }); apps.push(instance); return instance; }
async function miniRoot(records: unknown[], count = records.length, stage = "accepted_e6_sft_row") {
  const root = await mkdtemp(path.join(os.tmpdir(),"t2i-v2-")); const step = path.join(root,"mini/model/source"); await mkdir(step,{recursive:true});
  await writeFile(path.join(root,"mini/manifest.json"),JSON.stringify({ schema_version:2,record_schema_version:2,id:"mini",title:"Mini",models:[{id:"model",label:"Model",steps:[{id:"source",label:"Source",review_stage:stage,status:"partial",record_count:count,target_count:30,shortfall_reason:"Fixture"}]}] }));
  await writeFile(path.join(step,"set.json"),JSON.stringify(records)); return root;
}
const host = { host: "127.0.0.1" };
describe("v2 API", () => {
  it("serves five-panel baseline validation predictions with their exact output text", async () => {
    const row = {sample_index:1,source_sample_id:"validation-1",review_stage:"baseline_validation_prediction",message_input_text:"Segment the ship",message_output_text:"",source_annotation_text:"GT ship",source_dataset:"SIOR_T",source_split:"valid",source_manifest_path:null,panel_roles:["original image","pred_overlay","gt_overlay","pred_mask","gt_mask"],asset_paths:{},evidence:{num_timesteps:50}};
    const root = await miniRoot([row],1,"baseline_validation_prediction");
    await copyFile(path.join(fixtureRoot,"sft-e6.0-r30/refseg/sior-t/sample-1.png"),path.join(root,"mini/model/source/sample-1.png"));
    const instance = await app(root);
    const response = await instance.inject({url:"/api/v2/datasets/mini/model/source",headers:host});
    expect(response.statusCode).toBe(200);
    const body = response.json<DatasetResponse>();
    expect(body.records[0]?.panel_roles).toEqual(["original image","pred_overlay","gt_overlay","pred_mask","gt_mask"]);
    expect(body.records[0]?.message_output_text).toBe("");
    expect(body.images["1"]?.status).toBe("available");
  });
  it("rejects incomplete four-panel records while retaining three-panel compatibility", async () => {
    const row = {sample_index:1,source_sample_id:"x",review_stage:"accepted_e6_sft_row",message_input_text:"x",message_output_text:"",source_annotation_text:null,source_dataset:"x",source_split:"train",source_manifest_path:null,panel_roles:["original","pred_overlay","gt_overlay","pred_mask"],asset_paths:{},evidence:{}};
    const instance = await app(await miniRoot([row]));
    const response = await instance.inject({url:"/api/v2/datasets/mini/model/source",headers:host});
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("RECORD_INVALID");
  });
  it("discovers independent datasets, including an empty root", async () => {
    const empty = await app(await mkdtemp(path.join(os.tmpdir(),"t2i-empty-")));
    expect((await empty.inject({url:"/api/v2/catalog",headers:host})).json<CatalogResponse>().datasets).toEqual([]);
    const instance = await app(); const response = await instance.inject({url:"/api/v2/catalog",headers:host});
    expect(response.statusCode).toBe(200); expect(response.json<CatalogResponse>().datasets.map((x) => x.id)).toEqual(["basemodel-task-r30","sft-e6.0-r30"]);
    expect((await instance.inject({url:"/api/v2/catalog",headers:{...host,"if-none-match":response.headers.etag!}})).statusCode).toBe(304);
    const oneRoot = await mkdtemp(path.join(os.tmpdir(),"t2i-one-"));
    await cp(path.join(fixtureRoot,"sft-e6.0-r30"),path.join(oneRoot,"sft-e6.0-r30"),{recursive:true});
    const one = await app(oneRoot);
    expect((await one.inject({url:"/api/v2/catalog",headers:host})).json<CatalogResponse>().datasets.map((x) => x.id)).toEqual(["sft-e6.0-r30"]);
  });
  it("returns exact text, named step and a rooted image", async () => {
    const instance = await app(); const response = await instance.inject({url:"/api/v2/datasets/sft-e6.0-r30/refseg/sior-t",headers:host});
    expect(response.statusCode).toBe(200); const body = response.json<DatasetResponse>();
    expect(body.records[0]?.message_input_text).toContain("<SEG>"); expect(body.records[0]?.message_output_text).toBe("");
    expect(body.images["1"]?.url).toContain("/api/v2/images/");
    const image = await instance.inject({url:body.images["1"]!.url!,headers:host}); expect(image.statusCode).toBe(200); expect(image.headers["content-type"]).toContain("image/png");
    expect(body.records[0]?.panel_roles).toEqual(["original","input_aux","output"]);
  });
  it("shows blocked steps as empty without synthetic records", async () => {
    const instance = await app(); const response = await instance.inject({url:"/api/v2/datasets/basemodel-task-r30/refseg/official",headers:host});
    expect(response.statusCode).toBe(200); expect(response.json<DatasetResponse>().records).toEqual([]);
  });
  it("keeps paper text separate from unavailable training Message text", async () => {
    const row = {sample_index:1,source_sample_id:"paper:fig9:fish",review_stage:"paper_example",message_input_text:null,message_output_text:null,paper_input_text:"<p>fish</p>",paper_output_text:null,source_annotation_text:null,source_dataset:"Dense200",source_split:"not established",source_manifest_path:null,panel_roles:["paper input","paper figure","paper output"],asset_paths:{},evidence:{}};
    const instance = await app(await miniRoot([row],1,"paper_example"));
    const response = await instance.inject({url:"/api/v2/datasets/mini/model/source",headers:host});
    expect(response.statusCode).toBe(200);
    const published = response.json<DatasetResponse>().records[0]!;
    expect(published.message_input_text).toBeNull();
    expect(published.paper_input_text).toBe("<p>fish</p>");
  });
  it("rejects count mismatch, path escape, and undeclared tuples", async () => {
    const instance = await app(await miniRoot([],1));
    expect((await instance.inject({url:"/api/v2/datasets/mini/model/source",headers:host})).json().error.code).toBe("COUNT_MISMATCH");
    expect((await instance.inject({url:"/api/v2/datasets/mini/model/../source",headers:host})).statusCode).not.toBe(200);
    expect((await instance.inject({url:"/api/v2/datasets/mini/model/other",headers:host})).statusCode).toBe(422);
  });
  it("rejects symlinked media and non-loopback host", async () => {
    const root = await miniRoot([{sample_index:1,source_sample_id:"x",review_stage:"accepted_e6_sft_row",message_input_text:"x",message_output_text:"",source_annotation_text:null,source_dataset:"x",source_split:"train",source_manifest_path:null,panel_roles:["original","auxiliary","output"],asset_paths:{},evidence:{}}]);
    await symlink("/etc/hosts",path.join(root,"mini/model/source/sample-1.png"));
    const instance = await app(root);
    const response = await instance.inject({url:"/api/v2/datasets/mini/model/source",headers:host});
    expect(response.json<DatasetResponse>().images["1"]?.status).toBe("missing");
    expect((await instance.inject({url:"/api/v2/catalog",headers:{host:"example.com"}})).statusCode).toBe(403);
  });
  it("revalidates a cached image after its file is replaced", async () => {
    const row = {sample_index:1,source_sample_id:"x",review_stage:"accepted_e6_sft_row",message_input_text:"x",message_output_text:"",source_annotation_text:null,source_dataset:"x",source_split:"train",source_manifest_path:null,panel_roles:["original","auxiliary","output"],asset_paths:{},evidence:{}};
    const root = await miniRoot([row]); const imagePath = path.join(root,"mini/model/source/sample-1.png");
    await copyFile(path.join(fixtureRoot,"sft-e6.0-r30/refseg/sior-t/sample-1.png"),imagePath);
    const instance = await app(root);
    expect((await instance.inject({url:"/api/v2/images/mini/model/source/1",headers:host})).statusCode).toBe(200);
    await unlink(imagePath); await symlink("/etc/hosts",imagePath);
    expect((await instance.inject({url:"/api/v2/images/mini/model/source/1",headers:host})).statusCode).toBe(404);
  });
});
