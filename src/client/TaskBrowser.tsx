import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { childLabel, type BrowseNode, type ExperimentSelection } from "./browseTree.js";
import { SelectionMenu } from "./SelectionMenu.js";
export function TaskBrowser({ items, onSelect }: {
    items: BrowseNode[];
    onSelect: (selection: ExperimentSelection) => void;
}) {
    const [expanded, setExpanded] = useState<string>();
    const browser = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    const id = useId();
    useEffect(() => {
        if (!expanded)
            return;
        const dismissOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !browser.current?.querySelector(".task-card.expanded")?.contains(event.target))
                setExpanded(undefined);
        };
        const dismissOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setExpanded(undefined);
                toggle.current?.focus();
            }
        };
        document.addEventListener("pointerdown", dismissOutside);
        document.addEventListener("keydown", dismissOnEscape);
        return () => { document.removeEventListener("pointerdown", dismissOutside); document.removeEventListener("keydown", dismissOnEscape); };
    }, [expanded]);
    return <div className="pair-gallery task-gallery" ref={browser}>
    {items.map(model => <div className={`task-card${expanded === model.id ? " expanded" : ""}`} key={model.id}>
      <button className="pair-card" aria-label={`${expanded === model.id ? "收起" : "展开"} ${model.label} ${childLabel(model)}`} aria-expanded={expanded === model.id} aria-controls={`${id}-${model.id}`} onClick={event => {
                toggle.current = event.currentTarget;
                setExpanded(expanded === model.id ? undefined : model.id);
            }}>
        <strong>{model.label}</strong><span className="task-expand">{expanded === model.id ? "收起" : "展开"}<ChevronDown size={16} aria-hidden="true"/></span>
      </button>
      {expanded === model.id ? <SelectionMenu key={model.id} id={`${id}-${model.id}`} items={items} initial={model} onSelect={selection => { onSelect(selection); setExpanded(undefined); toggle.current?.focus(); }}/> : null}
    </div>)}
  </div>;
}
