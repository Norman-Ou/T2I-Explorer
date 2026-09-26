/* eslint-disable react-hooks/refs -- dnd-kit exposes ref-backed bindings during render. */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
export function SortableColumnHeader({ id, label, stepLabel, index, total, onMove, onRemove, status, error }: {
  id: string; label: string; stepLabel: string; index: number; total: number; onMove: (delta: number) => void; onRemove: () => void;
  status?: "loading" | "error"; error?: string;
}) {
  const sortable = useSortable({ id });
  return <div ref={sortable.setNodeRef} className="column-header" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button className="drag-handle" aria-label={`Drag ${label}, ${stepLabel}`} {...sortable.attributes} {...sortable.listeners}>⋮⋮</button>
    <div><strong>{label}</strong><span>{stepLabel}</span>
      {status === "loading" ? <span className="column-status">Loading…</span> : null}
      {status === "error" ? <span className="column-status error" title={error}>Unavailable</span> : null}
    </div>
    <div className="column-actions">
      <button disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} left`}>←</button>
      <button disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${label} right`}>→</button>
      <button onClick={onRemove} aria-label={`Remove ${label}, ${stepLabel}`}>×</button>
    </div>
  </div>;
}
