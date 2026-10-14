/* eslint-disable react-hooks/refs -- dnd-kit exposes ref-backed bindings during render. */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DataOrigin } from "../shared/contracts.js";
import { ColumnTitle } from "./ColumnTitle.js";
export function SortableColumnHeader({ id, label, sourceTitle, expTitle, origin, index, total, onMove, onRemove, onRetry, status, error }: {
    id: string;
    label: string;
    sourceTitle: string;
    index: number;
    total: number;
    onMove: (delta: number) => void;
    onRemove: () => void;
    onRetry?: () => void;
    status?: "loading" | "error";
    error?: string;
    origin?: DataOrigin;
    expTitle: string;
}) {
    const sortable = useSortable({ id });
    return <div ref={sortable.setNodeRef} className="column-header" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button className="drag-handle" aria-label={`Drag ${label}, ${sourceTitle}`} {...sortable.attributes} {...sortable.listeners}>⋮⋮</button>
    <ColumnTitle task={label} source={sourceTitle} experiment={expTitle} origin={origin}>
      {status === "loading" ? <span className="column-status">Loading…</span> : null}
      {status === "error" ? <span className="column-status error" title={error}>Unavailable</span> : null}
    </ColumnTitle>
    <div className="column-actions">
      {status === 'error' ? <button onClick={onRetry} aria-label={`Retry column ${index + 1}`}>Retry</button> : null}
      <button disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move column ${index + 1} left`}>←</button>
      <button disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move column ${index + 1} right`}>→</button>
      <button onClick={onRemove} aria-label={`Remove ${label}, ${sourceTitle}`}>×</button>
    </div>
  </div>;
}
