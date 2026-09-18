/* eslint-disable react-hooks/refs -- dnd-kit intentionally exposes ref-backed sortable bindings during render. */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableColumnHeader({ id, label, step, index, total, onMove, onRemove, status, error }: {
  id: string;
  label: string;
  step: number;
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  status?: "loading" | "error";
  error?: string;
}) {
  const sortable = useSortable({ id });
  return (
    <div
      ref={sortable.setNodeRef}
      className="column-header"
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    >
      <button className="drag-handle" aria-label={`Drag ${label}, step ${step}`} {...sortable.attributes} {...sortable.listeners}>⋮⋮</button>
      <div><strong>{label}</strong><span>Step {step}</span>
        {status === "loading" ? <span className="column-status">Loading dataset…</span> : null}
        {status === "error" ? <span className="column-status error" title={error}>Dataset unavailable</span> : null}
      </div>
      <div className="column-actions">
        <button disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} left`}>←</button>
        <button disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${label} right`}>→</button>
        <button onClick={onRemove} aria-label={`Remove ${label}, step ${step}`}>×</button>
      </div>
    </div>
  );
}
