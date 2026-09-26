import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CatalogResponse, ImageDescriptor, ModelV2, RecordV2, StepV2 } from "../shared/contracts.js";
import { alignRows, filterRows, orderRows, type LoadedColumn } from "../shared/order.js";
import { api } from "./api.js";
import { Lightbox } from "./Lightbox.js";
import { SortableColumnHeader } from "./SortableColumnHeader.js";
import { activeParts, parseViewState, serializeViewState, tupleParts, type Mode, type ViewState } from "./urlState.js";

type ColumnState = LoadedColumn & { loading?: boolean };
type Pair = { model: ModelV2; step: StepV2 };
function displayText(value: string | null) { return value === null ? <span className="empty-text">Unavailable</span> : value === "" ? <span className="empty-text">(exact empty string)</span> : value; }
function ImageCell({ descriptor, record, onOpen }: { descriptor?: ImageDescriptor; record: RecordV2; onOpen: (button: HTMLButtonElement) => void }) {
  const [failed, setFailed] = useState(false);
  if (!descriptor || descriptor.status === "missing") return <div className="image-state warning"><strong>Review image unavailable</strong><span>{descriptor?.file_name ?? `sample-${record.sample_index}.png`}</span></div>;
  if (descriptor.status === "invalid" || failed) return <div className="image-state error"><strong>Image cannot be decoded</strong><span>{descriptor.file_name}</span></div>;
  return <button className="image-button" onClick={(event) => onOpen(event.currentTarget)} aria-label={`Open three-panel review for ${record.source_sample_id}`}>
    <img src={descriptor.url} alt={`Original, auxiliary, output review for ${record.source_sample_id}`} width={descriptor.width} height={descriptor.height} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    {descriptor.status === "ambiguous" ? <span className="image-warning">Multiple files; showing {descriptor.file_name}</span> : null}
  </button>;
}
function RecordCell({ record, descriptor, sampleIndex, onOpen }: { record?: RecordV2; descriptor?: ImageDescriptor; sampleIndex: number; onOpen: (button: HTMLButtonElement) => void }) {
  if (!record) return <div className="record-cell missing"><strong>No record</strong><span>Sample {sampleIndex} is absent in this column.</span></div>;
  return <article className="record-cell"><div className="sample-meta"><strong>{record.source_sample_id}</strong><span>{record.review_stage.replaceAll("_", " ")}</span></div>
    <ImageCell descriptor={descriptor} record={record} onOpen={onOpen} />
    <div className="panel-roles">{record.panel_roles.join(" | ")}</div>
    <section><h3>Input text</h3><p>{displayText(record.message_input_text)}</p></section>
    <section><h3>Output text</h3><p>{displayText(record.message_output_text)}</p></section>
    {record.source_annotation_text !== null ? <section><h3>Source annotation text</h3><p>{record.source_annotation_text}</p></section> : null}
  </article>;
}
export function App() {
  const [view, setView] = useState<ViewState>(() => parseViewState(window.location.search));
  const [queryInput, setQueryInput] = useState(view.query);
  const [datasetSearch, setDatasetSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerFirst, setPickerFirst] = useState("");
  const [catalog, setCatalog] = useState<CatalogResponse>();
  const [catalogError, setCatalogError] = useState<string>();
  const [columns, setColumns] = useState<Map<string, ColumnState>>(new Map());
  const [reloading, setReloading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("t2i.sidebar.collapsed") === "true");
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(480, Math.max(240, Number(localStorage.getItem("t2i.sidebar.width")) || 320)));
  const focusReturn = useRef<HTMLElement | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const selectedKeys = view.columns;
  const updateView = useCallback((updater: ViewState | ((current: ViewState) => ViewState), replace = false) => {
    setView((current) => { const next = typeof updater === "function" ? updater(current) : updater; window.history[replace ? "replaceState" : "pushState"]({}, "", `${window.location.pathname}${serializeViewState(next)}`); return next; });
  }, []);
  useEffect(() => { const onPop = () => { const state = parseViewState(window.location.search); setView(state); setQueryInput(state.query); }; window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  useEffect(() => { window.history.replaceState({}, "", `${window.location.pathname}${serializeViewState(parseViewState(window.location.search))}`); }, []);
  const loadCatalog = useCallback(async () => { try { setCatalog(await api.catalog()); setCatalogError(undefined); } catch (error) { setCatalogError(error instanceof Error ? error.message : String(error)); } }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  const dataset = catalog?.datasets.find((item) => item.id === view.datasetId);
  const pairs = useMemo<Pair[]>(() => dataset?.models.flatMap((model) => model.steps.map((step) => ({ model, step }))) ?? [], [dataset]);
  const pairFor = (key: string) => { const tuple = tupleParts(key); return tuple ? pairs.find(({ model, step }) => model.id === tuple.modelId && step.id === tuple.stepId) : undefined; };
  useEffect(() => {
    if (!catalog) return;
    const selected = catalog.datasets.find((item) => item.id === view.datasetId);
    const valid = new Set(selected?.models.flatMap((model) => model.steps.map((step) => `${model.id}:${step.id}`)) ?? []);
    const filtered = view.columns.filter((key) => { const tuple = tupleParts(key); return tuple && valid.has(`${tuple.modelId}:${tuple.stepId}`); });
    const linkedCell = activeParts(view.active);
    const invalidCell = Boolean(view.active && (!linkedCell || !filtered.includes(linkedCell.key) || linkedCell.sampleIndex < 1 || linkedCell.sampleIndex > 30));
    if (filtered.length !== view.columns.length || (view.datasetId && !selected) || invalidCell) updateView({ ...view, datasetId: selected?.id, columns: filtered, active: invalidCell ? undefined : view.active, notice: "An unavailable dataset, column, or cell was removed from the link." }, true);
  }, [catalog, updateView, view]);
  useEffect(() => { const timer = window.setTimeout(() => { if (queryInput !== view.query) updateView({ ...view, query: queryInput.trim(), page: 1 }, true); }, 300); return () => window.clearTimeout(timer); }, [queryInput, updateView, view]);
  useEffect(() => {
    const controller = new AbortController();
    if (!view.datasetId) { setColumns(new Map()); return () => controller.abort(); }
    setColumns((current) => { const next = new Map<string, ColumnState>(); for (const key of selectedKeys) next.set(key, current.get(key) ?? { key, loading: true }); return next; });
    const queue = [...selectedKeys];
    const worker = async () => { while (queue.length) { const key = queue.shift(); if (!key) return; const tuple = tupleParts(key); if (!tuple) continue;
      try { const data = await api.dataset(view.datasetId!, tuple.modelId, tuple.stepId, controller.signal); if (!controller.signal.aborted) setColumns((current) => new Map(current).set(key, { key, data })); }
      catch (error) { if (!controller.signal.aborted) setColumns((current) => new Map(current).set(key, { key, error: error instanceof Error ? error.message : String(error) })); }
    } };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker())); return () => controller.abort();
  }, [view.datasetId, selectedKeys.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderedColumns = selectedKeys.map((key) => columns.get(key) ?? { key, loading: true });
  const aligned = alignRows(orderedColumns);
  const filtered = filterRows(aligned, view.query, selectedKeys.flatMap((key) => { const pair = pairFor(key); return pair ? [pair.model.label, pair.step.label] : []; }));
  const ordered = orderRows(filtered, view.order, view.seed);
  const pageCount = Math.max(1, Math.ceil(ordered.length / view.pageSize)); const page = Math.min(view.page, pageCount);
  const visibleRows = ordered.slice((page - 1) * view.pageSize, page * view.pageSize);
  useEffect(() => { if (view.page !== page) updateView({ ...view, page }, true); }, [page, updateView, view]);
  const diagnostics = [...(catalog?.diagnostics ?? []), ...orderedColumns.flatMap((column) => column.data?.diagnostics ?? [])];
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const active = activeParts(view.active); const activeColumn = active ? columns.get(active.key)?.data : undefined;
  const activeRecord = activeColumn?.records.find((record) => record.sample_index === active?.sampleIndex);
  const activeImage = activeRecord ? activeColumn?.images[String(activeRecord.sample_index)] : undefined;
  const activePair = active ? pairFor(active.key) : undefined;
  const selection = activeRecord && activeImage?.url && activePair ? { modelLabel: activePair.model.label, stepLabel: activePair.step.label, record: activeRecord, image: activeImage } : undefined;
  const available = ordered.flatMap((row) => selectedKeys.flatMap((key) => { const record = row.records.get(key); const descriptor = columns.get(key)?.data?.images[String(row.sampleIndex)]; return record && descriptor?.url ? [{ key, record }] : []; }));
  const moveActive = (delta: number) => { if (!view.active || !available.length) return; const index = available.findIndex((item) => `${item.key}:${item.record.sample_index}` === view.active); const next = available[(Math.max(0,index)+delta+available.length)%available.length]; if (next) updateView({ ...view, active: `${next.key}:${next.record.sample_index}` }, true); };
  const closeLightbox = () => { if (!view.active) return; updateView({ ...view, active: undefined }, true); window.setTimeout(() => focusReturn.current?.focus(), 0); };
  const reorder = (from: number, to: number) => { if (to < 0 || to >= view.columns.length || from === to) return; const next = [...view.columns]; const [item] = next.splice(from,1); if (!item) return; next.splice(to,0,item); updateView({ ...view, columns: next }); };
  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => { if (over && dragged.id !== over.id) reorder(view.columns.indexOf(String(dragged.id)), view.columns.indexOf(String(over.id))); };
  const addPair = (pair: Pair) => { const token = crypto.randomUUID().slice(0,8); updateView({ ...view, columns: [...view.columns, `${pair.model.id}:${pair.step.id}:${token}`], page: 1 }); setPickerOpen(false); setPickerFirst(""); };
  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const start = event.clientX; const initial = sidebarWidth; const move = (next: PointerEvent) => setSidebarWidth(Math.min(480,Math.max(240,initial+next.clientX-start))); const stop = () => { window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",stop); }; window.addEventListener("pointermove",move); window.addEventListener("pointerup",stop); };
  useEffect(() => localStorage.setItem("t2i.sidebar.width",String(sidebarWidth)),[sidebarWidth]); useEffect(() => localStorage.setItem("t2i.sidebar.collapsed",String(sidebarCollapsed)),[sidebarCollapsed]);
  const groupedFirst = view.mode === "steps" ? [...new Map(pairs.map((pair) => [pair.step.id, pair.step.label])).entries()] : dataset?.models.map((model) => [model.id,model.label] as [string,string]) ?? [];
  const pickerChoices = pairs.filter((pair) => (view.mode === "steps" ? pair.step.id === pickerFirst : pair.model.id === pickerFirst) && `${pair.model.label} ${pair.step.label}`.toLowerCase().includes(pickerSearch.toLowerCase()));
  const visibleDatasets = catalog?.datasets.filter((item) => `${item.title} ${item.id}`.toLowerCase().includes(datasetSearch.toLowerCase())) ?? [];
  const setMode = (mode: Mode) => { setPickerFirst(""); updateView({ ...view, mode }); };
  return <div className="app-shell" style={{ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` } as React.CSSProperties}>
    <header className="topbar"><button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-expanded={!sidebarCollapsed} aria-controls="explorer-sidebar">{sidebarCollapsed ? "Show navigation" : "Hide navigation"}</button>
      <div><h1>Text-to-Image Explorer</h1><span>{dataset?.title ?? "Explore task and source examples"}</span></div>
      <div className="topbar-actions"><button disabled={reloading} onClick={async () => { setReloading(true); try { setCatalog(await api.reload()); } finally { setReloading(false); } }}>{reloading ? "Reloading…" : "Reload data"}</button><button onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button></div>
    </header>
    <aside id="explorer-sidebar" className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Explorer navigation">{!sidebarCollapsed ? <>
      <label>Dataset<select value={view.datasetId ?? ""} onChange={(event) => { setQueryInput(""); setPickerOpen(false); updateView({ ...view, datasetId: event.target.value || undefined, columns: [], query: "", page: 1, active: undefined }); }}><option value="">Select Dataset</option>{catalog?.datasets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="nav-section-title">Mode</div><div className="mode-control" role="group" aria-label="Mode">{(["gallery","steps","models"] as const).map((mode) => <button key={mode} className={view.mode === mode ? "active" : ""} aria-pressed={view.mode === mode} onClick={() => setMode(mode)}>{mode[0]!.toUpperCase()+mode.slice(1)}</button>)}</div>
      <label>Search examples<input type="search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Text, source ID, task…" disabled={!dataset} /></label>
      <div className="order-controls"><button className={view.order === "id" ? "selected" : ""} onClick={() => updateView({ ...view, order: "id", page: 1 })} disabled={!dataset}>Ordered</button><button className={view.order === "shuffle" ? "selected" : ""} onClick={() => { const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0; updateView({ ...view, order: "shuffle", seed, page: 1 }); }} disabled={!dataset}>Shuffle</button></div>
      <div className="selected-title"><strong>Selected columns <span>{view.columns.length}</span></strong><button aria-label="Add column" disabled={!dataset} onClick={() => { setPickerOpen((open) => !open); setPickerFirst(""); }}>+</button></div>
      {pickerOpen && dataset ? <div className="picker"><label>Find task or source<input autoFocus type="search" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} /></label>
        {!pickerFirst ? groupedFirst.filter(([, label]) => label.toLowerCase().includes(pickerSearch.toLowerCase())).map(([id,label]) => <button key={id} onClick={() => { setPickerFirst(id); setPickerSearch(""); }}>{label} →</button>) : <><button className="picker-back" onClick={() => setPickerFirst("")}>← Back</button>{pickerChoices.map((pair) => <button key={`${pair.model.id}:${pair.step.id}`} onClick={() => addPair(pair)}><strong>{pair.model.label}</strong> · {pair.step.label}<small>{pair.step.status} · {pair.step.record_count}/{pair.step.target_count}</small></button>)}{!pickerChoices.length ? <p>No matching pairs.</p> : null}</>}
      </div> : null}
      <div className="selected-list">{view.columns.map((key,index) => { const pair = pairFor(key); return <div className="selected-card" key={key}><strong>{pair?.model.label ?? key}</strong><span>{pair?.step.label}</span><div><button disabled={index===0} onClick={() => reorder(index,index-1)} aria-label={`Move selected column ${index+1} up`}>↑</button><button disabled={index===view.columns.length-1} onClick={() => reorder(index,index+1)} aria-label={`Move selected column ${index+1} down`}>↓</button><button onClick={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })} aria-label={`Remove selected column ${index+1}`}>×</button></div></div>; })}</div>
      <label>Page size<select value={view.pageSize} onChange={(event) => updateView({ ...view, pageSize: Number(event.target.value) as ViewState["pageSize"], page: 1 })}>{[10,25,50,100].map((size) => <option key={size}>{size}</option>)}</select></label>
      <details className="diagnostics"><summary>Diagnostics · {errorCount} errors · {diagnostics.length-errorCount} warnings</summary>{diagnostics.length ? <ul>{diagnostics.map((item,index) => <li key={`${item.code}-${index}`} className={item.severity}><strong>{item.code}</strong><span>{item.message}</span>{item.public_path ? <code>{item.public_path}</code> : null}</li>)}</ul> : <p>No diagnostics.</p>}</details>
    </> : null}</aside>
    {!sidebarCollapsed ? <nav aria-label="Navigation resize" className="sidebar-resizer-holder"><div className="sidebar-resizer" role="separator" aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSidebarWidth((width) => Math.min(480,Math.max(240,width+(event.key==="ArrowLeft"?-16:16)))); } }} /></nav> : null}
    <main className="main-content">{view.notice ? <div className="notice" role="status">{view.notice}</div> : null}{catalogError ? <div className="error-banner" role="alert"><strong>Catalog unavailable</strong><span>{catalogError}</span><button onClick={() => void loadCatalog()}>Retry</button></div> : null}
      {!dataset ? <div className="dataset-landing"><div className="landing-heading"><h2>Text-to-Image Explorer</h2><p>Select a dataset to explore its tasks, sources, and review examples.</p></div><label className="dataset-search">Search datasets<input type="search" value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} placeholder="Search by name" /></label><div className="results-summary">{visibleDatasets.length} datasets</div><div className="dataset-grid">{visibleDatasets.map((item) => { const all = item.models.flatMap((model) => model.steps); const records = all.reduce((sum,step) => sum+step.record_count,0); return <button className="dataset-card" key={item.id} onClick={() => updateView({ ...view, datasetId: item.id, columns: [], active: undefined })}><strong>{item.title}</strong><span>{item.description ?? "Task and source review"}</span><small>{all.length} task/source pairs · {records} records</small></button>; })}</div>{catalog && !visibleDatasets.length ? <div className="empty-state">No published datasets match this search.</div> : null}</div> : <>
        <div className="page-heading"><div><h2>{dataset.title}</h2><p>{dataset.description ?? "Inspect task and source review examples."}</p></div><span>{pairs.length} available pairs</span></div>
        {view.mode === "gallery" ? <div className="pair-gallery">{pairs.map((pair) => <button key={`${pair.model.id}:${pair.step.id}`} className="pair-card" onClick={() => addPair(pair)}><strong>{pair.model.label}</strong><span>{pair.step.label}</span><small>{pair.step.review_stage.replaceAll("_"," ")} · {pair.step.status} · {pair.step.record_count}/{pair.step.target_count}</small>{pair.step.shortfall_reason ? <em>{pair.step.shortfall_reason}</em> : null}</button>)}</div> : null}
        {view.mode !== "gallery" ? <div className="group-browser">{groupedFirst.map(([id,label]) => {
          const groupPairs = pairs.filter((pair) => view.mode === "steps" ? pair.step.id === id : pair.model.id === id);
          return <section className="pair-group" key={id}><h3>{label}</h3><span>{groupPairs.length} {view.mode === "steps" ? (groupPairs.length === 1 ? "task" : "tasks") : (groupPairs.length === 1 ? "step" : "steps")}</span>
            <div className="pair-gallery">{groupPairs.map((pair) => <button key={`${pair.model.id}:${pair.step.id}`} className="pair-card" onClick={() => addPair(pair)}><strong>{pair.model.label}</strong><span>{pair.step.label}</span><small>{pair.step.status} · {pair.step.record_count}/{pair.step.target_count}</small>{pair.step.shortfall_reason ? <em>{pair.step.shortfall_reason}</em> : null}</button>)}</div>
          </section>;
        })}</div> : null}
        {!view.columns.length ? <div className="empty-state"><h3>Build a comparison</h3><p>Add a task/source column with + or choose a card above.</p></div> : <><div className="results-summary" aria-live="polite">{ordered.length} ordinal rows · page {page} of {pageCount}</div>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}><SortableContext items={view.columns} strategy={horizontalListSortingStrategy}><div className="comparison-scroll"><div className="comparison-grid" style={{ gridTemplateColumns: `88px repeat(${Math.max(1,view.columns.length)}, minmax(360px, 1fr))` }}><div className="prompt-id-header">R30 #</div>
            {view.columns.map((key,index) => { const pair = pairFor(key); const column = columns.get(key); return <SortableColumnHeader key={key} id={key} label={pair?.model.label ?? key} stepLabel={pair?.step.label ?? ""} index={index} total={view.columns.length} status={column?.loading ? "loading" : column?.error ? "error" : undefined} error={column?.error} onMove={(delta) => reorder(index,index+delta)} onRemove={() => updateView({ ...view, columns: view.columns.filter((item) => item!==key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })} />; })}
            {visibleRows.flatMap((row) => [<div key={`id-${row.sampleIndex}`} className="prompt-id-cell">{row.sampleIndex}</div>,...view.columns.map((key) => { const column = columns.get(key); if (column?.loading) return <div key={`${key}-${row.sampleIndex}`} className="record-cell loading" aria-busy="true">Loading…</div>; if (column?.error) return <div key={`${key}-${row.sampleIndex}`} className="record-cell dataset-error"><strong>Dataset unavailable</strong><span>{column.error}</span></div>; return <RecordCell key={`${key}-${row.sampleIndex}`} sampleIndex={row.sampleIndex} record={row.records.get(key)} descriptor={column?.data?.images[String(row.sampleIndex)]} onOpen={(button) => { focusReturn.current = button; updateView({ ...view, active: `${key}:${row.sampleIndex}` }, true); }} />; })])}</div></div></SortableContext></DndContext>
          <nav className="pagination" aria-label="Pagination"><button disabled={page<=1} onClick={() => updateView({ ...view, page: page-1 })}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page>=pageCount} onClick={() => updateView({ ...view, page: page+1 })}>Next</button></nav></>}
      </>}
      {view.active && !selection && orderedColumns.every((column) => !column.loading) ? <div className="notice" role="status">The linked record or image is unavailable. <button onClick={() => updateView({ ...view, active: undefined }, true)}>Dismiss</button></div> : null}
    </main><Lightbox selection={selection} onClose={closeLightbox} onPrevious={() => moveActive(-1)} onNext={() => moveActive(1)} />
  </div>;
}
