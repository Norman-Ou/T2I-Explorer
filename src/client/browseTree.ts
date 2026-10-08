import type { Experiment, SourceDataset, Task } from "../shared/contracts.js";
import type { ViewMode } from "./urlState.js";
export type ExperimentSelection = {
    task: Task;
    dataset: SourceDataset;
    exp: Experiment;
};
export type BrowseNode = {
    id: string;
    label: string;
    kind: "task" | "dataset" | "exp";
    origin?: SourceDataset["data_origin"];
    children?: BrowseNode[];
    selection?: ExperimentSelection;
};
export function childLabel(node: BrowseNode): string { return node.kind === "task" ? "数据来源" : node.kind === "dataset" ? "实验" : "任务"; }
export function buildBrowseTree(tasks: Task[], mode: ViewMode): BrowseNode[] {
    if (mode === "task")
        return tasks.map(task => ({ id: task.id, label: task.title, kind: "task", children: task.datasets.map(dataset => ({
                id: dataset.id, label: dataset.title, kind: "dataset", origin: dataset.data_origin, children: dataset.exps.map(exp => ({ id: exp.id, label: exp.title, kind: "exp", selection: { task, dataset, exp } }))
            })) }));
    const exps = new Map<string, string>();
    for (const task of tasks)
        for (const dataset of task.datasets)
            for (const exp of dataset.exps)
                if (!exps.has(exp.id))
                    exps.set(exp.id, exp.title);
    return [...exps].map(([id, label]) => ({ id, label, kind: "exp", children: tasks.flatMap(task => {
            const children: BrowseNode[] = task.datasets.flatMap(dataset => {
                const exp = dataset.exps.find(exp => exp.id === id);
                return exp ? [{ id: dataset.id, label: dataset.title, kind: "dataset", origin: dataset.data_origin, selection: { task, dataset, exp } }] : [];
            });
            return children.length ? [{ id: task.id, label: task.title, kind: "task" as const, children }] : [];
        }) }));
}
