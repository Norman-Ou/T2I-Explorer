import { useEffect, useRef } from "react";
import type { SampleView } from "../shared/contracts.js";
import { JsonInspector } from "./JsonInspector.js";
import { MediaPanels } from "./MediaPanels.js";
import { SampleText } from "./SampleText.js";
type Selection = {
    taskTitle: string;
    sourceTitle: string;
    expTitle: string;
    record: SampleView;
};
export function Lightbox({ selection, onClose, generation = 0 }: {
    selection?: Selection;
    onClose: () => void;
    generation?: number;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const startedOutside = useRef(false);
    useEffect(() => { const element = dialog.current; if (!element)
        return; if (selection && !element.open)
        element.showModal(); if (!selection && element.open)
        element.close(); }, [selection]);
    if (!selection)
        return <dialog ref={dialog}/>;
    const { record, taskTitle, sourceTitle, expTitle } = selection;
    const outside = (element: HTMLDialogElement, x: number, y: number) => { const bounds = element.getBoundingClientRect(); return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom; };
    return <dialog ref={dialog} className="lightbox" aria-label={`${taskTitle} · ${sourceTitle} · ${expTitle} · sample ${record.sample_id}`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} onPointerDown={event => { startedOutside.current = outside(event.currentTarget, event.clientX, event.clientY); }}
    // WebKit can omit the next pointerdown after dragging a native image.
    onMouseDown={event => { startedOutside.current = outside(event.currentTarget, event.clientX, event.clientY); }} onPointerCancel={() => { startedOutside.current = false; }} onClick={event => { if (startedOutside.current && outside(event.currentTarget, event.clientX, event.clientY))
        onClose(); startedOutside.current = false; }}>
    <button className="lightbox-close primary" onClick={onClose}>Close</button>
    <div className="lightbox-layout"><div className="lightbox-image-wrap"><MediaPanels record={record} generation={generation}/></div>
      <aside className="details-panel" aria-label="Record details"><div className="record-identity"><strong>{taskTitle}</strong><span>{sourceTitle}</span><span>{expTitle}</span><span>Source ID {record.sample_id}</span></div>
        <SampleText record={record}/>
        <p>Panels: {record.panels.map(panel => panel.title).join(" | ")}</p><JsonInspector record={record}/></aside></div>
  </dialog>;
}
