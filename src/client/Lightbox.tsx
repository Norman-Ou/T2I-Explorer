import { useEffect, useRef } from "react";
import type { ImageDescriptor, RecordV1 } from "../shared/contracts.js";
import { JsonInspector } from "./JsonInspector.js";

type Selection = {
  modelLabel: string;
  modelId: string;
  step: number;
  record: RecordV1;
  image: ImageDescriptor;
};

export function Lightbox({ selection, onClose, onPrevious, onNext }: {
  selection?: Selection;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (selection && !element.open) element.showModal();
    if (!selection && element.open) element.close();
  }, [selection]);
  if (!selection) return <dialog ref={dialog} />;
  const { record, image, modelLabel, step } = selection;
  return (
    <dialog ref={dialog} className="lightbox" aria-labelledby="lightbox-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
      <div className="lightbox-bar">
        <h2 id="lightbox-title">{modelLabel} · step {step} · prompt ID {record.prompt_id}</h2>
        <div className="lightbox-actions">
          <button onClick={onPrevious} aria-label="Previous available image">Previous</button>
          <button onClick={onNext} aria-label="Next available image">Next</button>
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="lightbox-layout">
        <div className="lightbox-image-wrap">
          <img src={image.url} alt={`Generated image for prompt ID ${record.prompt_id}, ${modelLabel}, step ${step}`} />
        </div>
        <aside className="details-panel" aria-label="Record details">
          <div className="record-identity"><strong>{modelLabel}</strong><span>Step {step}</span><span>Prompt ID {record.prompt_id}</span></div>
          <JsonInspector record={record} />
        </aside>
      </div>
    </dialog>
  );
}
