import { useEffect, useRef, useState } from 'react';
import type { PanelView, SampleView } from '../shared/contracts.js';
import { mediaLoader, type MediaKind, type MediaState } from './mediaLoader.js';

function MediaPanel({ panel, record, onOpen }: {
    panel: PanelView;
    record: SampleView;
    onOpen?: (button: HTMLButtonElement) => void;
}) {
    const kind: MediaKind = onOpen ? 'thumbnail' : 'original';
    const url = kind === 'thumbnail' ? panel.thumbnail_url ?? panel.url : panel.url;
    const available = panel.status === 'available' && Boolean(url);
    const figure = useRef<HTMLElement>(null);
    const subscription = useRef<ReturnType<typeof mediaLoader.subscribe> | undefined>(undefined);
    const [visible, setVisible] = useState(kind === 'original' || typeof IntersectionObserver === 'undefined');
    const [state, setState] = useState<MediaState>({ status: 'queued' });

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
            {src ? <img src={src} alt={panel.title} width={panel.width} height={panel.height} decoding="async" onError={() => subscription.current?.decodeFailed()}/> : null}
            {state.status === 'error' ? <div className="panel-unavailable"><strong>Image unavailable</strong><span>{state.error}</span></div> : null}
            {loading ? <span className="panel-progress">{state.status === 'retrying' ? 'Retrying…' : 'Loading…'}</span> : null}
        </>;

    return <figure ref={figure} className="media-panel" data-media-state={available ? state.status : 'missing'}>
        <div className="panel-frame" aria-busy={loading}>
            {onOpen && available ? <button className="panel-button" aria-label={`Open all ${record.panels.length} panels for ${record.sample_id}: ${panel.title}`} onClick={event => onOpen(event.currentTarget)}>{content}</button>
                : <div className="panel-image">{content}</div>}
            {available && state.status === 'error' ? <button className="panel-retry" aria-label={`Retry ${panel.title}`} onClick={() => subscription.current?.retry()}>Retry</button> : null}
        </div>
        <figcaption>{panel.title}</figcaption>
    </figure>;
}

export function MediaPanels({ record, onOpen, generation = 0 }: {
    record: SampleView;
    onOpen?: (button: HTMLButtonElement) => void;
    generation?: number;
}) {
    return <div className="media-panels" style={{ gridTemplateColumns: `repeat(${record.panels.length}, minmax(0, 1fr))` }}>{record.panels.map(panel =>
        <MediaPanel key={`${generation}:${panel.id}:${panel.status}:${panel.url}:${panel.thumbnail_url}:${Boolean(onOpen)}`} panel={panel} record={record} onOpen={onOpen}/>
    )}</div>;
}
