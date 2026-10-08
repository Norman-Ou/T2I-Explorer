import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedColumn } from '../shared/order.js';
import { api } from './api.js';
import { tupleParts } from './urlState.js';

type ColumnState = LoadedColumn & { loading?: boolean };

export function useExperimentColumns(collection: string | undefined, keys: string[], revision: unknown) {
    const [loaded, setLoaded] = useState<{ collection: string | undefined; selection: string; revision: unknown; columns: Map<string, ColumnState> }>();
    const enqueueRetry = useRef<((key: string) => void) | undefined>(undefined);
    const selection = JSON.stringify([...keys].sort());
    const pending = useMemo(() => new Map<string, ColumnState>((collection ? JSON.parse(selection) as string[] : []).map(key => [key, { key, loading: true }])), [collection, selection]);
    useEffect(() => {
        const controller = new AbortController();
        const selected = JSON.parse(selection) as string[];
        const queue = collection ? [...selected] : [];
        const running = new Set<string>();
        const update = (key: string, column: ColumnState) => setLoaded(current => ({
            collection, selection, revision,
            columns: new Map(current && current.collection === collection && current.selection === selection && current.revision === revision ? current.columns : pending).set(key, column)
        }));
        const drain = () => {
            while (!controller.signal.aborted && collection && running.size < 4 && queue.length) {
                const key = queue.shift()!;
                const tuple = tupleParts(key);
                if (!tuple) continue;
                running.add(key);
                void api.experiment(collection, tuple.taskId, tuple.datasetId, tuple.expId, controller.signal)
                    .then(data => { if (!controller.signal.aborted) update(key, { key, data }); })
                    .catch(error => {
                        if (!controller.signal.aborted) update(key, {
                            key, error: error instanceof Error || error instanceof DOMException ? error.message : String(error)
                        });
                    })
                    .finally(() => { running.delete(key); drain(); });
            }
        };
        enqueueRetry.current = key => {
            if (!selected.includes(key) || running.has(key) || queue.includes(key) || controller.signal.aborted) return;
            update(key, { key, loading: true });
            queue.push(key);
            drain();
        };
        drain();
        return () => { controller.abort(); enqueueRetry.current = undefined; };
    }, [collection, selection, revision, pending]);
    const retry = useCallback((key: string) => enqueueRetry.current?.(key), []);
    const columns = loaded && loaded.collection === collection && loaded.selection === selection && loaded.revision === revision ? loaded.columns : pending;
    return { columns, retry };
}
