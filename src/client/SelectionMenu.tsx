import { useLayoutEffect, useRef, useState } from "react";
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
    const menu = useRef<HTMLDivElement>(null);
    const start = initial ? 1 : 0;
    const levels = [{ parent: initial, nodes: initial?.children ?? items }, ...path.slice(start).map(parent => ({ parent, nodes: parent.children ?? [] }))];
    const matches = (node: BrowseNode): boolean => `${node.label} ${node.id}`.toLowerCase().includes(query.toLowerCase()) || (node.children?.some(matches) ?? false);
    useLayoutEffect(() => {
        if (inline) return;
        const position = () => {
            const element = menu.current;
            if (!element?.parentElement) return;
            const left = element.parentElement.getBoundingClientRect().left;
            const width = Math.min(element.scrollWidth, window.innerWidth - 24);
            const shift = Math.max(12 - left, Math.min(0, window.innerWidth - 12 - left - width));
            element.style.left = `${shift}px`;
        };
        position();
        window.addEventListener("resize", position);
        document.addEventListener("scroll", position, true);
        return () => { window.removeEventListener("resize", position); document.removeEventListener("scroll", position, true); };
    }, [inline, path, query]);
    const navigate = (node: BrowseNode, column: number) => {
        setPath([...path.slice(0, start + column), node]);
        onNavigate?.();
    };
    return <div ref={menu} id={id} className={`task-sources${inline ? " inline" : ""}`}>
      {levels.map(({ parent, nodes }, column) => {
        const visible = nodes.filter(matches);
        return <ul className="selection-column" key={column} aria-label={parent ? `${parent.label} ${childLabel(parent)}` : "选择比较项"}>
          {visible.map(node => <li key={node.id}><button title={node.label} aria-expanded={node.children ? path[start + column]?.id === node.id : undefined} aria-label={node.selection ? `添加 ${node.selection.task.title} · ${node.selection.dataset.title} · ${node.selection.exp.title}` : `选择 ${node.label}`} onClick={() => {
            if (node.selection) onSelect(node.selection);
            else navigate(node, column);
          }} onKeyDown={event => {
            if (event.key === "ArrowRight" && node.children) {
                event.preventDefault(); navigate(node, column);
                window.requestAnimationFrame(() => menu.current?.querySelectorAll(".selection-column")[column + 1]?.querySelector<HTMLButtonElement>("button")?.focus());
            }
            if (event.key === "ArrowLeft" && column > 0) {
                event.preventDefault(); setPath(path.slice(0, start + column - 1));
                menu.current?.querySelectorAll(".selection-column")[column - 1]?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
            }
          }}>
            {node.kind === "dataset" ? <SourceOriginBadge origin={node.origin}/> : null}
            <span>{node.label}</span>{node.children ? <ChevronRight className="selection-chevron" size={15} aria-hidden="true"/> : null}
          </button></li>)}
          {!visible.length ? <li className="empty-text">No matching choices.</li> : null}
        </ul>;
      })}
    </div>;
}
