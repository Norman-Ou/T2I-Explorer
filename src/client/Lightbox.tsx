import { useEffect, useRef } from "react";
import type { ImageDescriptor, RecordV2 } from "../shared/contracts.js";
import { JsonInspector } from "./JsonInspector.js";
type Selection = { modelLabel: string; stepLabel: string; record: RecordV2; image: ImageDescriptor };
export function Lightbox({ selection, onClose, onPrevious, onNext }: { selection?: Selection; onClose: () => void; onPrevious: () => void; onNext: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (!element) return; if (selection && !element.open) element.showModal(); if (!selection && element.open) element.close(); }, [selection]);
  if (!selection) return <dialog ref={dialog} />;
  const { record, image, modelLabel, stepLabel } = selection;
  return <dialog ref={dialog} className="lightbox" aria-labelledby="lightbox-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <div className="lightbox-bar"><h2 id="lightbox-title">{modelLabel} · {stepLabel} · sample {record.sample_index}</h2><div className="lightbox-actions">
      <button onClick={onPrevious} aria-label="Previous available image">Previous</button><button onClick={onNext} aria-label="Next available image">Next</button><button className="primary" onClick={onClose}>Close</button>
    </div></div>
    <div className="lightbox-layout"><div className="lightbox-image-wrap"><img src={image.url} alt={`Three-panel review for ${record.source_sample_id}`} /></div>
      <aside className="details-panel" aria-label="Record details"><div className="record-identity"><strong>{modelLabel}</strong><span>{stepLabel}</span><span>Source ID {record.source_sample_id}</span><span>{record.review_stage}</span></div>
        <h3>Input text</h3><p className="exact-text">{record.message_input_text === null ? "Unavailable" : record.message_input_text}</p>
        <h3>Output text</h3><p className="exact-text">{record.message_output_text === null ? "Unavailable" : record.message_output_text === "" ? "(exact empty string)" : record.message_output_text}</p>
        {record.review_stage === "paper_example" ? <>
          <h3>Paper input text</h3><p className="exact-text">{record.paper_input_text ?? "Unavailable"}</p>
          <h3>Paper output text</h3><p className="exact-text">{record.paper_output_text ?? "Unavailable"}</p>
        </> : null}
        <p>Panels: {record.panel_roles.join(" | ")}</p><JsonInspector record={record} /></aside></div>
  </dialog>;
}
