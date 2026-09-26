import { useState } from "react";
import type { JsonValue } from "../shared/contracts.js";

function typeOf(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function Scalar({ value }: { value: null | boolean | number | string }) {
  const display = value === null ? "null" : typeof value === "string" ? value : String(value);
  return <span className={`json-value json-${typeOf(value)}`}>{display}</span>;
}

function Node({ name, value, depth }: { name: string; value: JsonValue; depth: number }) {
  const compound = Array.isArray(value) || (value !== null && typeof value === "object");
  const [open, setOpen] = useState(depth === 0 && !compound);
  const [limit, setLimit] = useState(200);
  if (!compound) {
    return (
      <div className="json-row">
        <span className="json-key">{name}</span><span className="type-badge">{typeOf(value)}</span>
        <Scalar value={value as null | boolean | number | string} />
        {typeof value === "string" && value.length > 80 ? <button className="copy-button" onClick={() => navigator.clipboard.writeText(value)}>Copy</button> : null}
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((child, index) => [String(index), child] as const) : Object.entries(value);
  return (
    <div className="json-node">
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {name}
        <span className="type-badge">{Array.isArray(value) ? "array" : "object"}</span>
        <span className="item-count">{entries.length} {entries.length === 1 ? "item" : "items"}</span>
      </button>
      {open ? <div className="json-children">
        {entries.slice(0, limit).map(([key, child]) => <Node key={key} name={key} value={child} depth={depth + 1} />)}
        {entries.length > limit ? <button className="load-more" onClick={() => setLimit((current) => current + 200)}>Show 200 more items</button> : null}
      </div> : null}
    </div>
  );
}

export function JsonInspector({ record }: { record: Record<string, JsonValue | undefined> }) {
  return <div className="json-inspector">{Object.entries(record).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined).map(([key, value]) => <Node key={key} name={key} value={value} depth={0} />)}</div>;
}
