import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PanelView, SampleView } from '../shared/contracts.js';
import { sampleIdentity } from '../shared/sampleIdentity.js';
import { mediaLoader, type MediaKind, type MediaState } from './mediaLoader.js';

export function MediaPanel({ panel, record, onOpen, onZoom, kind = 'original', expanded = false }: {
    panel: PanelView;
    record: SampleView;
    onOpen?: (button: HTMLButtonElement) => void;
    onZoom?: (panel: PanelView, button: HTMLButtonElement) => void;
    kind?: MediaKind;
    expanded?: boolean;
}) {
    const url = kind === 'thumbnail' ? panel.thumbnail_url ?? panel.url : panel.url;
    const available = panel.status === 'available' && Boolean(url);
    const figure = useRef<HTMLElement>(null);
    const subscription = useRef<ReturnType<typeof mediaLoader.subscribe> | undefined>(undefined);
    const [visible, setVisible] = useState(kind === 'original' || typeof IntersectionObserver === 'undefined');
    const [state, setState] = useState<MediaState>({ status: 'queued' });
    const [aspectRatio, setAspectRatio] = useState(panel.width && panel.height ? panel.width / panel.height : 1);

    useLayoutEffect(() => {
        if (!expanded) return;
        const element = figure.current;
        const frame = element?.querySelector<HTMLElement>('.panel-frame');
        if (!element || !frame) return;
        // Firefox does not include a height-constrained image in max-content width.
        // Measure the available image height so the figure follows its actual ratio.
        const resize = () => { element.style.width = `${Math.max(80, (frame.getBoundingClientRect().height - 2) * aspectRatio + 2)}px`; };
        resize();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(resize);
        observer.observe(frame);
        return () => observer.disconnect();
    }, [expanded, aspectRatio]);

    useEffect(() => {
        if (visible || !available || !figure.current) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: '300px' });
        observer.observe(figure.current);
        return () => observer.disconnect();
    }, [visible, available]);

    useEffect(() => {
        if (!visible || !available || !url) return;
        const current = mediaLoader.subscribe(url, kind, setState);
        subscription.current = current;
        return () => { current.unsubscribe(); subscription.current = undefined; };
    }, [visible, available, url, kind]);

    const preview = kind === 'original' && panel.thumbnail_url ? mediaLoader.peek(panel.thumbnail_url) : undefined;
    const src = state.src ?? preview;
    const loading = available && state.status !== 'ready' && state.status !== 'error';
    const content = !available ? <div className="panel-unavailable"><strong>Image unavailable</strong><span>{panel.unavailable_reason}</span></div>
        : <>
            {src ? <img src={src} alt={panel.title} width={panel.width} height={panel.height} decoding="async" onLoad={event => { if (expanded && event.currentTarget.naturalHeight) setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); }} onError={() => subscription.current?.decodeFailed()}/> : null}
            {state.status === 'error' ? <div className="panel-unavailable"><strong>Image unavailable</strong><span>{state.error}</span></div> : null}
            {loading ? <span className="panel-progress">{state.status === 'retrying' ? 'Retrying…' : 'Loading…'}</span> : null}
        </>;

    return <figure ref={figure} className={`media-panel${expanded ? ' expanded-media-panel' : ''}`} data-media-state={available ? state.status : 'missing'}>
        <div className="panel-frame" aria-busy={loading}>
            {(onOpen || onZoom) && available ? <button className="panel-button" aria-label={onOpen ? `Open all ${record.panels.length} panels for ${sampleIdentity(record).displayId}: ${panel.title}` : `Enlarge ${panel.title}`} onClick={event => { if (onOpen) onOpen(event.currentTarget); else onZoom?.(panel, event.currentTarget); }}>{content}</button>
                : <div className="panel-image">{content}</div>}
            {available && state.status === 'error' ? <button className="panel-retry" aria-label={`Retry ${panel.title}`} onClick={() => subscription.current?.retry()}>Retry</button> : null}
        </div>
        <figcaption title={panel.title}>{panel.title}</figcaption>
    </figure>;
}

export function MediaPanels({ record, onOpen, onZoom, generation = 0 }: {
    record: SampleView;
    onOpen?: (button: HTMLButtonElement) => void;
    onZoom?: (panel: PanelView, button: HTMLButtonElement) => void;
    generation?: number;
}) {
    return <div className="media-panels" style={{ gridTemplateColumns: `repeat(${record.panels.length}, minmax(0, 1fr))` }}>{record.panels.map(panel =>
        <MediaPanel key={`${generation}:${panel.id}:${panel.status}:${panel.url}:${panel.thumbnail_url}:${Boolean(onOpen)}`} panel={panel} record={record} kind={onOpen ? 'thumbnail' : 'original'} onOpen={onOpen} onZoom={onZoom}/>
    )}</div>;
}
