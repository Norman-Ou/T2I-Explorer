import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CatalogResponse, Task, SampleView } from "../shared/contracts.js";
import { alignRows, filterRows, orderRows } from "../shared/order.js";
import { api } from "./api.js";
import { Lightbox } from "./Lightbox.js";
import { SortableColumnHeader } from "./SortableColumnHeader.js";
import { activeParts, parseViewState, serializeViewState, tupleParts, type ViewState } from "./urlState.js";
import { SampleText } from "./SampleText.js";
import { TaskBrowser } from "./TaskBrowser.js";
import { SourceOriginBadge } from "./SourceOriginBadge.js";
import { MediaPanels } from "./MediaPanels.js";
import { buildBrowseTree, type ExperimentSelection } from "./browseTree.js";
import { SelectionMenu } from "./SelectionMenu.js";
import { useExperimentColumns } from './useExperimentColumns.js';
type Pair = ExperimentSelection;
function RecordCell({ record, onOpen, generation }: {
    record?: SampleView;
    onOpen: (button: HTMLButtonElement) => void;
    generation: number;
}) {
    if (!record)
        return <div className="record-cell missing"><strong>No record</strong><span>This experiment has no record for this sample.</span></div>;
    return <article className="record-cell"><div className="sample-meta"><strong>{record.sample_id}</strong></div>
    <MediaPanels record={record} onOpen={onOpen} generation={generation}/>
    <SampleText record={record}/>
  </article>;
}
export function App() {
    const [view, setView] = useState<ViewState>(() => parseViewState(window.location.search));
    const [queryInput, setQueryInput] = useState(view.query);
    const [datasetSearch, setDatasetSearch] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSearch, setPickerSearch] = useState("");
    const [catalog, setCatalog] = useState<CatalogResponse>();
    const [catalogError, setCatalogError] = useState<string>();
    const [mediaGeneration, setMediaGeneration] = useState(0);
    const [reloading, setReloading] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("t2i.sidebar.collapsed") === "true");
    const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(480, Math.max(240, Number(localStorage.getItem("t2i.sidebar.width")) || 320)));
    const focusReturn = useRef<HTMLElement | undefined>(undefined);
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const selectedKeys = view.columns;
    const { columns, retry: retryColumn } = useExperimentColumns(catalog ? view.datasetId : undefined, selectedKeys, catalog);
    const updateView = useCallback((updater: ViewState | ((current: ViewState) => ViewState), replace = false) => {
        setView((current) => { const next = typeof updater === "function" ? updater(current) : updater; window.history[replace ? "replaceState" : "pushState"]({}, "", `${window.location.pathname}${serializeViewState(next)}`); return next; });
    }, []);
    useEffect(() => { const onPop = () => { const state = parseViewState(window.location.search); setView(state); setQueryInput(state.query); }; window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
    useEffect(() => { window.history.replaceState({}, "", `${window.location.pathname}${serializeViewState(parseViewState(window.location.search))}`); }, []);
    const loadCatalog = useCallback(async () => { try {
        setCatalog(await api.catalog());
        setCatalogError(undefined);
    }
    catch (error) {
        setCatalogError(error instanceof Error ? error.message : String(error));
    } }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Catalog state changes only after the asynchronous request settles.
    useEffect(() => { void loadCatalog(); }, [loadCatalog]);
    const dataset = catalog?.collections.find((item) => item.id === view.datasetId);
    const tasks = useMemo<Task[]>(() => dataset?.tasks.map((task) => ({ ...task,
        title: task.title.split(/[_\s]+/).map((word) => /^(gcg|vgd)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    })) ?? [], [dataset]);
    const pairs = useMemo<Pair[]>(() => tasks.flatMap(task => task.datasets.flatMap(dataset => dataset.exps.map(exp => ({ task, dataset, exp })))), [tasks]);
    const browseItems = useMemo(() => buildBrowseTree(tasks, view.mode), [tasks, view.mode]);
    const pairFor = (key: string) => { const tuple = tupleParts(key); return tuple ? pairs.find(({ task, dataset, exp }) => task.id === tuple.taskId && dataset.id === tuple.datasetId && exp.id === tuple.expId) : undefined; };
    useEffect(() => {
        if (!catalog)
            return;
        const selected = catalog.collections.find(item => item.id === view.datasetId);
        const filtered = view.columns.filter(key => {
            const tuple = tupleParts(key);
            return tuple && selected?.tasks.find(task => task.id === tuple.taskId)?.datasets.find(source => source.id === tuple.datasetId)?.exps.some(exp => exp.id === tuple.expId);
        });
        const linkedCell = activeParts(view.active);
        const active = linkedCell && filtered.includes(linkedCell.key) ? view.active : undefined;
        if (filtered.length !== view.columns.length || Boolean(view.datasetId && !selected) || active !== view.active)
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconcile externally supplied URL state with the loaded catalog.
            updateView({ ...view, datasetId: selected?.id, columns: filtered, active, notice: "An unavailable dataset, experiment or record was removed from the link." }, true);
    }, [catalog, updateView, view]);
    useEffect(() => { const timer = window.setTimeout(() => { if (queryInput !== view.query)
        updateView({ ...view, query: queryInput.trim(), page: 1 }, true); }, 300); return () => window.clearTimeout(timer); }, [queryInput, updateView, view]);
    const orderedColumns = selectedKeys.map(key => ({ ...(columns.get(key) ?? { key, loading: true }), expOrder: pairFor(key)?.dataset.exps.findIndex(exp => exp.id === pairFor(key)?.exp.id) }));
    const aligned = alignRows(orderedColumns);
    const filtered = filterRows(aligned, view.query, selectedKeys.flatMap((key) => { const pair = pairFor(key); return pair ? [pair.task.id, pair.task.title, pair.dataset.title, pair.exp.title] : []; }));
    const ordered = orderRows(filtered, view.order, view.seed);
    const pageCount = Math.max(1, Math.ceil(ordered.length / view.pageSize));
    const rowsReady = orderedColumns.every(column => !column.loading);
    const page = rowsReady ? Math.min(view.page, pageCount) : view.page;
    const visibleRows = ordered.slice((page - 1) * view.pageSize, page * view.pageSize);
    useEffect(() => { if (view.page !== page)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A completed experiment response may invalidate the linked page number.
        updateView({ ...view, page }, true); }, [page, updateView, view]);
    const active = activeParts(view.active);
    const activeColumn = active ? columns.get(active.key)?.data : undefined;
    const activeRecord = activeColumn?.records.find((record) => record.sample_id === active?.sampleId);
    const activePair = active ? pairFor(active.key) : undefined;
    const selection = activeRecord && activePair ? { taskTitle: activePair.task.title, sourceTitle: activePair.dataset.title, expTitle: activePair.exp.title, record: activeRecord } : undefined;
    const closeLightbox = () => { if (!view.active)
        return; updateView({ ...view, active: undefined }, true); window.setTimeout(() => focusReturn.current?.focus(), 0); };
    const reorder = (from: number, to: number) => { if (to < 0 || to >= view.columns.length || from === to)
        return; const next = [...view.columns]; const [item] = next.splice(from, 1); if (!item)
        return; next.splice(to, 0, item); updateView({ ...view, columns: next }); };
    const onDragEnd = ({ active: dragged, over }: DragEndEvent) => { if (over && dragged.id !== over.id)
        reorder(view.columns.indexOf(String(dragged.id)), view.columns.indexOf(String(over.id))); };
    const addPair = (pair: Pair) => { const token = crypto.randomUUID().slice(0, 8); updateView({ ...view, columns: [...view.columns, `${pair.task.id}:${pair.dataset.id}:${pair.exp.id}:${token}`], page: 1 }); setPickerOpen(false); };
    const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const start = event.clientX; const initial = sidebarWidth; const move = (next: PointerEvent) => setSidebarWidth(Math.min(480, Math.max(240, initial + next.clientX - start))); const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); };
    useEffect(() => localStorage.setItem("t2i.sidebar.width", String(sidebarWidth)), [sidebarWidth]);
    useEffect(() => localStorage.setItem("t2i.sidebar.collapsed", String(sidebarCollapsed)), [sidebarCollapsed]);
    const visibleDatasets = catalog?.collections.filter((item) => `${item.title} ${item.id}`.toLowerCase().includes(datasetSearch.toLowerCase())) ?? [];
    return <div className="app-shell" style={{ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` } as React.CSSProperties}>
    <header className="topbar">
      <h1>Text-to-Image Explorer</h1>
      <div className="topbar-actions"><button disabled={reloading} onClick={async () => { setReloading(true); try {
        setCatalog(await api.reload());
        setMediaGeneration(value => value + 1);
        setCatalogError(undefined);
    }
    catch (error) {
        setCatalogError(error instanceof Error ? error.message : String(error));
    }
    finally {
        setReloading(false);
    } }}>{reloading ? "Reloading…" : "Reload data"}</button><button onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button><button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-expanded={!sidebarCollapsed} aria-controls="explorer-sidebar">{sidebarCollapsed ? "Show navigation" : "Hide navigation"}</button></div>
    </header>
    <aside id="explorer-sidebar" className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Explorer navigation">{!sidebarCollapsed ? <>
      <label>Dataset<select value={view.datasetId ?? ""} onChange={(event) => { setQueryInput(""); setPickerOpen(false); updateView({ ...view, datasetId: event.target.value || undefined, columns: [], query: "", page: 1, active: undefined }); }}><option value="">Select Dataset</option>{catalog?.collections.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <fieldset className="view-mode-selector"><legend>View by</legend><div className="view-mode-control">{(["task", "exp"] as const).map(mode => <button key={mode} aria-pressed={view.mode === mode} onClick={() => { setPickerOpen(false); setPickerSearch(""); updateView({ ...view, mode }); }}>{mode === "task" ? "Task" : "Exp"}</button>)}</div></fieldset>
      <label>Search examples<input type="search" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Text, source ID, task…" disabled={!dataset}/></label>
      <div className="order-controls"><button className={view.order === "id" ? "selected" : ""} onClick={() => updateView({ ...view, order: "id", page: 1 })} disabled={!dataset}>Ordered</button><button className={view.order === "shuffle" ? "selected" : ""} onClick={() => { const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0; updateView({ ...view, order: "shuffle", seed, page: 1 }); }} disabled={!dataset}>Shuffle</button></div>
      <div className="selected-title"><strong>Selected columns <span>{view.columns.length}</span></strong><button aria-label="Add column" disabled={!dataset} onClick={() => { setPickerOpen((open) => !open); }}>+</button></div>
      {pickerOpen && dataset ? <div className="picker"><label>Find task, dataset or experiment<input autoFocus type="search" value={pickerSearch} onChange={event => setPickerSearch(event.target.value)}/></label>
        <SelectionMenu key={view.mode} items={browseItems} query={pickerSearch} inline onNavigate={() => setPickerSearch("")} onSelect={addPair}/>
      </div> : null}
      <div className="selected-list">{view.columns.map((key, index) => { const pair = pairFor(key); return <div className="selected-card" key={key}><strong>{pair?.task.title ?? key}</strong><span className="source-label"><SourceOriginBadge origin={pair?.dataset.data_origin}/>{pair?.dataset.title}</span><span className="experiment-label">{pair?.exp.title}</span><div><button disabled={index === 0} onClick={() => reorder(index, index - 1)} aria-label={`Move selected column ${index + 1} up`}>↑</button><button disabled={index === view.columns.length - 1} onClick={() => reorder(index, index + 1)} aria-label={`Move selected column ${index + 1} down`}>↓</button><button onClick={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })} aria-label={`Remove selected column ${index + 1}`}>×</button></div></div>; })}</div>
      <label>Page size<select value={view.pageSize} onChange={(event) => updateView({ ...view, pageSize: Number(event.target.value) as ViewState["pageSize"], page: 1 })}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
    </> : null}</aside>
    {!sidebarCollapsed ? <nav aria-label="Navigation resize" className="sidebar-resizer-holder"><div className="sidebar-resizer" role="separator" aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((width) => Math.min(480, Math.max(240, width + (event.key === "ArrowLeft" ? -16 : 16))));
    } }}/></nav> : null}
    <main className="main-content">{view.notice ? <div className="notice" role="status">{view.notice}</div> : null}{catalogError ? <div className="error-banner" role="alert"><strong>Catalog unavailable</strong><span>{catalogError}</span><button onClick={() => void loadCatalog()}>Retry</button></div> : null}
      {!dataset ? <div className="dataset-landing"><div className="landing-heading"><h2>Text-to-Image Explorer</h2><p>Select a dataset to explore its tasks, experiments, and review examples.</p></div><label className="dataset-search">Search datasets<input type="search" value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} placeholder="Search by name"/></label><div className="results-summary">{visibleDatasets.length} datasets</div><div className="dataset-grid">{visibleDatasets.map((item) => <button className="dataset-card" key={item.id} onClick={() => updateView({ ...view, datasetId: item.id, columns: [], active: undefined })}><strong>{item.title}</strong></button>)}</div>{catalog && !visibleDatasets.length ? <div className="empty-state">No published datasets match this search.</div> : null}</div> : <>
        <TaskBrowser key={`${dataset.id}:${view.mode}`} items={browseItems} onSelect={addPair}/>
        {!view.columns.length ? <div className="empty-state"><h2>Build a comparison</h2><p>Choose a task, dataset and experiment, or add a column with +.</p></div> : <><div className="results-summary" aria-live="polite">{ordered.length} comparison rows · page {page} of {pageCount}</div>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}><SortableContext items={view.columns} strategy={horizontalListSortingStrategy}><div className="comparison-scroll"><div className="comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, view.columns.length)}, minmax(360px, 1fr))` }}>
            {view.columns.map((key, index) => { const pair = pairFor(key); const column = columns.get(key); return <SortableColumnHeader key={key} id={key} label={pair?.task.title ?? key} sourceTitle={pair?.dataset.title ?? ""} expTitle={pair?.exp.title ?? ""} origin={pair?.dataset.data_origin} index={index} total={view.columns.length} status={column?.loading ? "loading" : column?.error ? "error" : undefined} error={column?.error} onRetry={() => retryColumn(key)} onMove={(delta) => reorder(index, index + delta)} onRemove={() => updateView({ ...view, columns: view.columns.filter((item) => item !== key), active: view.active?.startsWith(`${key}:`) ? undefined : view.active })}/>; })}
            {visibleRows.flatMap(row => view.columns.map(key => {
                    const column = columns.get(key);
                    const record = row.records.get(key);
                    if (column?.loading)
                        return <div key={`${key}-${row.sampleIndex}`} className="record-cell loading" aria-busy="true">Loading…</div>;
                    if (column?.error)
                        return <div key={`${key}-${row.sampleIndex}`} className="record-cell dataset-error"><strong>Experiment unavailable</strong><span>{column.error}</span></div>;
                    return <RecordCell key={`${key}-${row.sampleIndex}`} record={record} generation={mediaGeneration} onOpen={button => {
                            if (!record)
                                return;
                            focusReturn.current = button;
                            updateView({ ...view, active: `${key}:${record.sample_id}` }, true);
                        }}/>;
                }))}</div></div></SortableContext></DndContext>
          <nav className="pagination" aria-label="Pagination"><button disabled={page <= 1} onClick={() => updateView({ ...view, page: page - 1 })}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => updateView({ ...view, page: page + 1 })}>Next</button></nav></>}
      </>}
      {view.active && !selection && orderedColumns.every((column) => !column.loading) ? <div className="notice" role="status">The linked record or image is unavailable. <button onClick={() => updateView({ ...view, active: undefined }, true)}>Dismiss</button></div> : null}
    </main><Lightbox selection={selection} onClose={closeLightbox} generation={mediaGeneration}/>
  </div>;
}
