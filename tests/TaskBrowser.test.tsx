import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Experiment, Task } from "../src/shared/contracts.js";
import { TaskBrowser } from "../src/client/TaskBrowser.js";
import { buildBrowseTree } from "../src/client/browseTree.js";
afterEach(cleanup);
const exp = (id: string, label: string): Experiment => ({ id, title: label, record_count: 30, metadata: {} });
const tasks: Task[] = [
    { id: "refseg", title: "RefSeg", datasets: [{ id: "sior-t", title: "SIOR_T", data_origin: "native", exps: [exp("baseline", "Baseline"), exp("candidate", "Candidate")] }, { id: "fast-t", title: "FAST_T", data_origin: "derived", exps: [exp("baseline", "Baseline")] }] },
    { id: "detection", title: "Detection", datasets: [{ id: "vrsbench", title: "VRSBench", data_origin: "native", exps: [exp("baseline", "Baseline")] }] }
];
describe("task and experiment browser", () => {
    it("selects task -> dataset -> experiment, preserving classifications and duplicate choices", async () => {
        const selected: string[] = [];
        const user = userEvent.setup();
        render(<TaskBrowser items={buildBrowseTree(tasks, "task")} onSelect={pair => selected.push(`${pair.task.id}:${pair.dataset.id}:${pair.exp.id}`)}/>);
        expect(screen.queryByRole("button", { name: /SIOR_T/ })).toBeNull();
        await user.click(screen.getByRole("button", { name: "展开 RefSeg 数据来源" }));
        const list = screen.getByRole("list", { name: "RefSeg 数据来源" });
        expect(within(list).getByLabelText("原生")).toBeInTheDocument();
        expect(within(list).getByLabelText("衍生")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "选择 SIOR_T" }));
        expect(selected).toEqual([]);
        await user.click(screen.getByRole("button", { name: "添加 RefSeg · SIOR_T · Candidate" }));
        expect(selected).toEqual(["refseg:sior-t:candidate"]);
        expect(screen.queryByRole("list")).toBeNull();
        await user.click(screen.getByRole("button", { name: "展开 RefSeg 数据来源" }));
        await user.click(screen.getByRole("button", { name: "选择 SIOR_T" }));
        await user.click(screen.getByRole("button", { name: "添加 RefSeg · SIOR_T · Candidate" }));
        expect(selected).toEqual(["refseg:sior-t:candidate", "refseg:sior-t:candidate"]);
    });
    it("selects experiment -> task -> dataset and excludes sources without that experiment", async () => {
        const selected: string[] = [];
        const user = userEvent.setup();
        render(<TaskBrowser items={buildBrowseTree(tasks, "exp")} onSelect={pair => selected.push(`${pair.task.id}:${pair.dataset.id}:${pair.exp.id}`)}/>);
        await user.click(screen.getByRole("button", { name: "展开 Candidate 任务" }));
        await user.click(screen.getByRole("button", { name: "选择 RefSeg" }));
        expect(screen.queryByRole("button", { name: /FAST_T/ })).toBeNull();
        await user.click(screen.getByRole("button", { name: "添加 RefSeg · SIOR_T · Candidate" }));
        expect(selected).toEqual(["refseg:sior-t:candidate"]);
    });
    it("opens only one card and dismisses on Escape or outside click", async () => {
        const user = userEvent.setup();
        render(<><button>Outside</button><TaskBrowser items={buildBrowseTree(tasks, "task")} onSelect={() => { }}/></>);
        await user.click(screen.getByRole("button", { name: "展开 RefSeg 数据来源" }));
        await user.click(screen.getByRole("button", { name: "展开 Detection 数据来源" }));
        expect(screen.queryByRole("list", { name: "RefSeg 数据来源" })).toBeNull();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("list")).toBeNull();
        expect(screen.getByRole("button", { name: "展开 Detection 数据来源" })).toHaveFocus();
        await user.click(screen.getByRole("button", { name: "展开 RefSeg 数据来源" }));
        await user.click(screen.getByRole("button", { name: "Outside" }));
        expect(screen.queryByRole("list")).toBeNull();
    });
});
