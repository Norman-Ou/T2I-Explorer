import { describe, expect, it } from "vitest";
import { matchesDatasetSearch } from "../src/client/datasetSearch.js";

describe("dataset fuzzy search", () => {
    const dataset = { title: "SFT E6.0 results", id: "sft-e6.0-r30" };
    it.each(["", "  ", "SFT", "sft_e6_r30", "e6r30", "ＳＦＴ", "results"])("matches %j against name or ID", query => {
        expect(matchesDatasetSearch(dataset, query)).toBe(true);
    });
    it.each(["basemodel", "r30e6", "e7", "sft e6 results sft"])("rejects %j without joining or reordering fields", query => {
        expect(matchesDatasetSearch(dataset, query)).toBe(false);
    });
});
