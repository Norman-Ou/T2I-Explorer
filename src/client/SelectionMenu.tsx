import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { childLabel, type BrowseNode, type ExperimentSelection } from "./browseTree.js";
import { SourceOriginBadge } from "./SourceOriginBadge.js";
export function SelectionMenu({ items, initial, query = "", onNavigate, onSelect, id, inline = false }: {
    items: BrowseNode[];
    initial?: BrowseNode;
    query?: string;
    onNavigate?: () => void;
    onSelect: (selection: ExperimentSelection) => void;
    id?: string;
    inline?: boolean;
}) {
    const [path, setPath] = useState<BrowseNode[]>(initial ? [initial] : []);
    const current = path.at(-1);
    const nodes = current?.children ?? items;
    const matches = (node: BrowseNode): boolean => `${node.label} ${node.id}`.toLowerCase().includes(query.toLowerCase()) || (node.children?.some(matches) ?? false);
    const visible = nodes.filter(matches);
    return <ul id={id} className={`task-sources${inline ? " inline" : ""}`} aria-label={current ? `${current.label} ${childLabel(current)}` : "选择比较项"}>
    {path.length > (initial ? 1 : 0) ? <li className="selection-location"><button onClick={() => { setPath(path.slice(0, -1)); onNavigate?.(); }}>← 返回上一层</button><span>{path.map(node => node.label).join(" / ")}</span></li> : null}
    {visible.map(node => <li key={node.id}><button aria-label={node.selection ? `添加 ${node.selection.task.title} · ${node.selection.dataset.title} · ${node.selection.exp.title}` : `选择 ${node.label}`} onClick={() => {
                if (node.selection)
                    onSelect(node.selection);
                else {
                    setPath([...path, node]);
                    onNavigate?.();
                }
            }}>
      {node.kind === "dataset" ? <SourceOriginBadge origin={node.origin}/> : null}
      <span>{node.label}</span>{node.children ? <ChevronRight className="selection-chevron" size={15} aria-hidden="true"/> : null}
    </button></li>)}
    {!visible.length ? <li className="empty-text">No matching choices.</li> : null}
  </ul>;
}
