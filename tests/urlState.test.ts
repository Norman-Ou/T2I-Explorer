import { describe, expect, it } from "vitest";
import { parseViewState, serializeViewState, tupleParts } from "../src/client/urlState.js";
describe("v2 URL state", () => {
  it("round-trips named steps and repeated pair instances", () => {
    const state = parseViewState("?dataset=sft-e6.0-r30&mode=steps&cols=refseg%3Asior-t%3Aone,refseg%3Asior-t%3Atwo&q=%3CSEG%3E&order=shuffle&seed=123&page=2&pageSize=50&active=refseg%3Asior-t%3Atwo%3A1");
    expect(state.columns).toHaveLength(2); expect(state.mode).toBe("steps");
    expect(tupleParts(state.columns[1]!)).toEqual({ modelId: "refseg", stepId: "sior-t", instanceId: "two" });
    expect(parseViewState(serializeViewState(state))).toEqual(state);
  });
  it("drops unsafe values and falls back to Gallery", () => {
    const state = parseViewState("?dataset=..%2Fsecret&mode=unknown&cols=ok%3Asior-t%3Aa,bad%2Fid%3Ax%3Ab&page=-4&pageSize=99");
    expect(state.datasetId).toBeUndefined(); expect(state.columns).toEqual(["ok:sior-t:a"]);
    expect(state.mode).toBe("gallery"); expect(state.page).toBe(1); expect(state.pageSize).toBe(25);
    expect(state.notice).toMatch(/Unknown mode/);
  });
});
