import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CatalogResponse, ImageDescriptor, RecordV1 } from "../shared/contracts.js";
import { alignRows, filterRows, orderRows, type LoadedColumn } from "../shared/order.js";
import { api } from "./api.js";
import { Lightbox } from "./Lightbox.js";
import { SortableColumnHeader } from "./SortableColumnHeader.js";
import { activeParts, parseViewState, serializeViewState, tupleParts, type ViewState } from "./urlState.js";

type ColumnState = LoadedColumn & { loading?: boolean };

function modelLabel(catalog: CatalogResponse | undefined, evalId: string | undefined, key: string): string {
  const tuple = tupleParts(key);
  if (!tuple) return key;
  return catalog?.eval_sets.find((item) => item.id === evalId)?.models.find((model) => model.id === tuple.modelId)?.label ?? tuple.modelId;
}

function ImageCell({ descriptor, record, label, step, onOpen }: {
  descriptor?: ImageDescriptor;
  record: RecordV1;
  label: string;
  step: number;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!descriptor || descriptor.status === "missing") return <div className="image-state warning"><strong>Image missing</strong><span>{descriptor?.file_name ?? `p${record.prompt_id}.webp`}</span></div>;
  if (descriptor.status === "invalid" || failed) return <div className="image-state error"><strong>Image cannot be decoded</strong><span>{descriptor.file_name}</span></div>;
  return (
    <button className="image-button" onClick={(event) => onOpen(event.currentTarget)} aria-label={`Open generated image for prompt ID ${record.prompt_id}, ${label}, step ${step}`}>
      <img
        src={descriptor.url}
        alt={`Generated image for prompt ID ${record.prompt_id}, ${label}, step ${step}`}
        width={descriptor.width}
        height={descriptor.height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {descriptor.status === "ambiguous" ? <span className="image-warning">Multiple files; showing {descriptor.file_name}</span> : null}
    </button>
  );
}

function RecordCell({ record, descriptor, label, step, promptId, onOpen }: {
  record?: RecordV1;
  descriptor?: ImageDescriptor;
  label: string;
  step: number;
  promptId: number;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  if (!record) return <div className="record-cell missing"><strong>No record</strong><span>No record for prompt ID {promptId}.</span></div>;
  return (
    <article className="record-cell">
      <section><h3>Prompt</h3><p>{record.prompt || <span className="empty-text">Empty string</span>}</p></section>
      <section><h3>Prompt output</h3><p>{record.prompt_output || <span className="empty-text">Empty string</span>}</p></section>
      <ImageCell descriptor={descriptor} record={record} label={label} step={step} onOpen={onOpen} />
    </article>
  );
}

export function App() {
  const [view, setView] = useState<ViewState>(() => parseViewState(window.location.search));
  const [queryInput, setQueryInput] = useState(view.query);
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const [columns, setColumns] = useState<Map<string, ColumnState>>(new Map());
  const [reloading, setReloading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("t2i.sidebar.collapsed") === "true");
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(480, Math.max(240, Number(localStorage.getItem("t2i.sidebar.width")) || 320)));
  const focusReturn = useRef<HTMLElement | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const columnsKey = view.columns.join(",");
  const selectedKeys = useMemo(() => columnsKey ? columnsKey.split(",") : [], [columnsKey]);

  const updateView = useCallback((updater: ViewState | ((current: ViewState) => ViewState), replace = false) => {
    setView((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const url = `${window.location.pathname}${serializeViewState(next)}`;
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
      return next;
    });
  }, []);

  useEffect(() => {
    const onPop = () => {
      const state = parseViewState(window.location.search);
      setView(state);
      setQueryInput(state.query);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    window.history.replaceState({}, "", `${window.location.pathname}${serializeViewState(view)}`);
    // Initial canonicalization intentionally runs once; later changes go through updateView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const next = await api.catalog();
      setCatalog(next);
      setCatalogError(undefined);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (!catalog) return;
    const evalSet = catalog.eval_sets.find((item) => item.id === view.evalId);
    const valid = new Set(evalSet?.models.flatMap((model) => model.steps.map((step) => `${model.id}:${step}`)) ?? []);
    const filtered = view.columns.filter((key) => valid.has(key));
    const nextEval = evalSet ? view.evalId : undefined;
    if (filtered.length !== view.columns.length || nextEval !== view.evalId) {
      updateView({ ...view, evalId: nextEval, columns: filtered, page: 1, active: undefined }, true);
    }
  }, [catalog, updateView, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryInput !== view.query) updateView({ ...view, query: queryInput.trim(), page: 1 }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput, updateView, view]);

  useEffect(() => {
    const controller = new AbortController();
    if (!view.evalId) {
      setColumns(new Map());
      return () => controller.abort();
    }
    setColumns((current) => {
      const next = new Map<string, ColumnState>();
      for (const key of selectedKeys) next.set(key, current.get(key) ?? { key, loading: true });
      return next;
    });
    const queue = [...selectedKeys];
    const worker = async () => {
      while (queue.length) {
        const key = queue.shift();
        if (!key) return;
        const tuple = tupleParts(key);
        if (!tuple) continue;
        try {
          const data = await api.dataset(view.evalId!, tuple.modelId, tuple.step, controller.signal);
          setColumns((current) => new Map(current).set(key, { key, data }));
        } catch (error) {
          if (!controller.signal.aborted) setColumns((current) => new Map(current).set(key, { key, error: error instanceof Error ? error.message : String(error) }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
    return () => controller.abort();
  }, [view.evalId, selectedKeys]);

  const orderedColumns = useMemo(() => selectedKeys.map((key) => columns.get(key) ?? { key, loading: true }), [columns, selectedKeys]);
  const aligned = useMemo(() => alignRows(orderedColumns), [orderedColumns]);
  const filtered = useMemo(() => filterRows(aligned, view.query), [aligned, view.query]);
  const ordered = useMemo(() => orderRows(filtered, view.order, view.seed), [filtered, view.order, view.seed]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / view.pageSize));
  const page = Math.min(view.page, pageCount);
  const visibleRows = ordered.slice((page - 1) * view.pageSize, page * view.pageSize);

  useEffect(() => {
    if (view.page !== page) updateView({ ...view, page }, true);
  }, [page, updateView, view]);

  const evalSet = catalog?.eval_sets.find((item) => item.id === view.evalId);
  const diagnostics = useMemo(() => [
    ...(catalog?.diagnostics ?? []),
    ...orderedColumns.flatMap((column) => column.data?.diagnostics ?? [])
  ], [catalog, orderedColumns]);

  const active = activeParts(view.active);
  const activeKey = active ? `${active.modelId}:${active.step}` : undefined;
  const activeColumn = activeKey ? columns.get(activeKey)?.data : undefined;
  const activeRecord = activeColumn?.records.find((record) => record.prompt_id === active?.promptId);
  const activeImage = activeRecord ? activeColumn?.images[String(activeRecord.prompt_id)] : undefined;
  const selection = active && activeRecord && activeImage?.url ? {
    modelLabel: modelLabel(catalog, view.evalId, `${active.modelId}:${active.step}`),
    modelId: active.modelId,
    step: active.step,
    record: activeRecord,
    image: activeImage
  } : undefined;

  const available = useMemo(() => ordered.flatMap((row) => selectedKeys.flatMap((key) => {
    const tuple = tupleParts(key);
    const record = row.records.get(key);
    const descriptor = columns.get(key)?.data?.images[String(row.promptId)];
    return tuple && record && descriptor?.url ? [{ key, tuple, record }] : [];
  })), [ordered, selectedKeys, columns]);

  const moveActive = (delta: number) => {
    if (!view.active || !available.length) return;
    const index = available.findIndex((item) => `${item.key}:${item.record.prompt_id}` === view.active);
    const next = available[(Math.max(0, index) + delta + available.length) % available.length];
    if (next) updateView({ ...view, active: `${next.key}:${next.record.prompt_id}` }, true);
  };

  const closeLightbox = () => {
    if (!view.active) return;
    updateView({ ...view, active: undefined }, true);
    window.setTimeout(() => focusReturn.current?.focus(), 0);
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= view.columns.length || from === to) return;
    const next = [...view.columns];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    updateView({ ...view, columns: next });
  };

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    reorder(view.columns.indexOf(String(dragged.id)), view.columns.indexOf(String(over.id)));
  };

  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const initial = sidebarWidth;
    const move = (next: PointerEvent) => setSidebarWidth(Math.min(480, Math.max(240, initial + next.clientX - start)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  useEffect(() => localStorage.setItem("t2i.sidebar.width", String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem("t2i.sidebar.collapsed", String(sidebarCollapsed)), [sidebarCollapsed]);

  const gridStyle = { gridTemplateColumns: `88px repeat(${Math.max(1, view.columns.length)}, minmax(320px, 1fr))` };
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;

  return (
    <div className="app-shell" style={{ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-expanded={!sidebarCollapsed} aria-controls="explorer-sidebar">{sidebarCollapsed ? "Show navigation" : "Hide navigation"}</button>
        <div><h1>T2I Explorer</h1><span>{evalSet?.title ?? "Choose an evaluation set"}</span></div>
        <div className="topbar-actions">
          <button disabled={reloading} onClick={async () => { setReloading(true); try { setCatalog(await api.reload()); } finally { setReloading(false); } }}>{reloading ? "Reloading…" : "Reload data"}</button>
          <span className="share-warning">Links include IDs and search.</span><button onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button>
        </div>
      </header>

      <aside id="explorer-sidebar" className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Explorer navigation">
        {!sidebarCollapsed ? <>
          <label>Evaluation set<select value={view.evalId ?? ""} onChange={(event) => { setQueryInput(""); updateView({ ...view, evalId: event.target.value || undefined, columns: [], query: "", page: 1, active: undefined }); }}>
            <option value="">Select an evaluation set</option>
            {catalog?.eval_sets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label>
          <label>Search prompts<input type="search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="ID, prompt, or output" /></label>
          <fieldset><legend>Model and step columns</legend>
            {evalSet?.models.flatMap((model) => model.steps.map((step) => {
              const key = `${model.id}:${step}`;
              const selected = view.columns.includes(key);
              return <button key={key} className={selected ? "selected model-choice" : "model-choice"} disabled={selected} onClick={() => updateView({ ...view, columns: [...view.columns, key], page: 1 })}>{selected ? "Added" : "Add"} {model.label} · {step}</button>;
            })) ?? <p className="muted">Choose an evaluation set first.</p>}
          </fieldset>
          <div className="control-row"><label>Page size<select value={view.pageSize} onChange={(event) => updateView({ ...view, pageSize: Number(event.target.value) as ViewState["pageSize"], page: 1 })}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label></div>
          <div className="order-controls"><button className={view.order === "id" ? "selected" : ""} onClick={() => updateView({ ...view, order: "id", page: 1 })}>Order by ID</button><button className={view.order === "shuffle" ? "selected" : ""} onClick={() => { const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0; updateView({ ...view, order: "shuffle", seed, page: 1 }); }}>Shuffle</button></div>
          <details className="diagnostics"><summary>Diagnostics · {errorCount} errors · {warningCount} warnings</summary>{diagnostics.length ? <ul>{diagnostics.map((item, index) => <li key={`${item.code}-${index}`} className={item.severity}><strong>{item.code}</strong><span>{item.message}</span>{item.public_path ? <code>{item.public_path}</code> : null}</li>)}</ul> : <p>No diagnostics.</p>}</details>
        </> : null}
      </aside>
      {!sidebarCollapsed ? <div className="sidebar-resizer" role="separator" aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSidebarWidth((width) => Math.min(480, Math.max(240, width + (event.key === "ArrowLeft" ? -16 : 16)))); } }} /> : null}

      <main className="main-content">
        <nav className="view-tabs" aria-label="Explorer views"><button aria-current="page">Models</button><button disabled>Gallery · later</button><button disabled>Steps · later</button><button disabled>Table · later</button></nav>
        {view.notice ? <div className="notice" role="status">{view.notice}</div> : null}
        {view.active && activeColumn && !selection ? <div className="notice" role="status">The linked active record or image is unavailable. <button onClick={() => updateView({ ...view, active: undefined }, true)}>Dismiss</button></div> : null}
        {catalogError ? <div className="error-banner" role="alert"><strong>Catalog unavailable</strong><span>{catalogError}</span><button onClick={() => void loadCatalog()}>Retry</button></div> : null}
        {diagnostics.length ? <div className={errorCount ? "diagnostic-banner error" : "diagnostic-banner warning"} role="status">{errorCount} errors and {warningCount} warnings are available in Diagnostics.</div> : null}
        {!view.columns.length ? <div className="empty-state"><h2>Build a comparison</h2><p>Choose an evaluation set and add one or more model/step columns from navigation.</p></div> : <>
          <div className="results-summary" aria-live="polite">{ordered.length} aligned rows · page {page} of {pageCount}</div>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={view.columns} strategy={horizontalListSortingStrategy}>
              <div className="comparison-scroll"><div className="comparison-grid" style={gridStyle}>
                <div className="prompt-id-header">Prompt ID</div>
                {view.columns.map((key, index) => { const tuple = tupleParts(key)!; const column = columns.get(key); return <SortableColumnHeader key={key} id={key} label={modelLabel(catalog, view.evalId, key)} step={tuple.step} index={index} total={view.columns.length} status={column?.loading ? "loading" : column?.error ? "error" : undefined} error={column?.error} onMove={(delta) => reorder(index, index + delta)} onRemove={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), page: 1, active: view.active?.startsWith(`${key}:`) ? undefined : view.active })} />; })}
                {visibleRows.flatMap((row) => [
                  <div key={`id-${row.promptId}`} className="prompt-id-cell">{row.promptId}</div>,
                  ...view.columns.map((key) => { const tuple = tupleParts(key)!; const column = columns.get(key); if (column?.loading) return <div key={`${key}-${row.promptId}`} className="record-cell loading" aria-busy="true">Loading…</div>; if (column?.error) return <div key={`${key}-${row.promptId}`} className="record-cell dataset-error"><strong>Dataset unavailable</strong><span>{column.error}</span></div>; const record = row.records.get(key); return <RecordCell key={`${key}-${row.promptId}`} promptId={row.promptId} record={record} descriptor={column?.data?.images[String(row.promptId)]} label={modelLabel(catalog, view.evalId, key)} step={tuple.step} onOpen={(button) => { focusReturn.current = button; updateView({ ...view, active: `${key}:${row.promptId}` }, true); }} />; })
                ])}
              </div></div>
            </SortableContext>
          </DndContext>
          <nav className="pagination" aria-label="Pagination"><button disabled={page <= 1} onClick={() => updateView({ ...view, page: page - 1 })}>Previous page</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => updateView({ ...view, page: page + 1 })}>Next page</button></nav>
        </>}
      </main>
      <Lightbox selection={selection} onClose={closeLightbox} onPrevious={() => moveActive(-1)} onNext={() => moveActive(1)} />
    </div>
  );
}
