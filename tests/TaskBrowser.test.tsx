import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Experiment, Task } from "../src/shared/contracts.js";
import { TaskBrowser } from "../src/client/TaskBrowser.js";
import { SelectionMenu } from "../src/client/SelectionMenu.js";
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
        expect(list).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "选择 FAST_T" })).toBeVisible();
        expect(screen.getByRole("list", { name: "SIOR_T 实验" })).toBeVisible();
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

    it("replaces only the child column when a different source is selected", async () => {
        const user = userEvent.setup();
        render(<TaskBrowser items={buildBrowseTree(tasks, "task")} onSelect={() => { }}/>);
        await user.click(screen.getByRole("button", { name: "展开 RefSeg 数据来源" }));
        await user.click(screen.getByRole("button", { name: "选择 SIOR_T" }));
        await user.click(screen.getByRole("button", { name: "选择 FAST_T" }));
        expect(screen.getByRole("list", { name: "RefSeg 数据来源" })).toBeVisible();
        expect(screen.queryByRole("list", { name: "SIOR_T 实验" })).toBeNull();
        expect(screen.getByRole("list", { name: "FAST_T 实验" })).toBeVisible();
        expect(screen.queryByRole("button", { name: /添加.*Candidate/ })).toBeNull();
    });

    it("keeps all three inline levels and switches the selected task branch", async () => {
        const user = userEvent.setup();
        const selected: string[] = [];
        render(<SelectionMenu items={buildBrowseTree(tasks, "task")} inline onSelect={pair => selected.push(pair.exp.id)}/>);
        await user.click(screen.getByRole("button", { name: "选择 RefSeg" }));
        await user.click(screen.getByRole("button", { name: "选择 SIOR_T" }));
        expect(screen.getAllByRole("list")).toHaveLength(3);
        expect(screen.getByRole("button", { name: "选择 Detection" })).toBeVisible();
        expect(selected).toEqual([]);
        await user.click(screen.getByRole("button", { name: "选择 Detection" }));
        expect(screen.getAllByRole("list")).toHaveLength(2);
        expect(screen.queryByRole("list", { name: "SIOR_T 实验" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "选择 VRSBench" }));
        await user.click(screen.getByRole("button", { name: "添加 Detection · VRSBench · Baseline" }));
        expect(selected).toEqual(["baseline"]);
    });
});
