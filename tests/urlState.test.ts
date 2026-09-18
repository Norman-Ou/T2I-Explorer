import { describe, expect, it } from "vitest";
import { parseViewState, serializeViewState } from "../src/client/urlState.js";

describe("URL state", () => {
  it("round-trips comparison state in canonical order", () => {
    const state = parseViewState("?eval=sample-eval&view=models&cols=model-b%3A2,model-a%3A1&q=cat&order=shuffle&seed=123&page=2&pageSize=50&active=model-a%3A1%3A42");
    expect(serializeViewState(state)).toBe("?eval=sample-eval&cols=model-b%3A2%2Cmodel-a%3A1&q=cat&order=shuffle&seed=123&page=2&pageSize=50&active=model-a%3A1%3A42");
  });

  it("drops unsafe values and visibly falls back from later views", () => {
    const state = parseViewState("?eval=../secret&view=gallery&cols=ok:1,bad%2Fid:2&page=-4&pageSize=99");
    expect(state.evalId).toBeUndefined();
    expect(state.columns).toEqual(["ok:1"]);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(25);
    expect(state.notice).toMatch(/not available/);
  });
});
