import { isRetryable, requestAttempt, retryDelay, RETRY_DELAYS } from './request.js';

export type MediaKind = 'thumbnail' | 'original';
export type MediaState = { status: 'queued' | 'loading' | 'retrying' | 'ready' | 'error'; src?: string; error?: string };
type Listener = (state: MediaState) => void;
type Job = {
    key: string; url: string; kind: MediaKind; state: MediaState; listeners: Set<Listener>;
    controller: AbortController; attempts: number; timer?: ReturnType<typeof setTimeout>;
};

export class MediaLoader {
    private jobs = new Map<string, Job>();
    private queues: Record<MediaKind, Job[]> = { thumbnail: [], original: [] };
    private active: Record<MediaKind, number> = { thumbnail: 0, original: 0 };
    private limits: Record<MediaKind, number> = { thumbnail: 4, original: 2 };

    peek(url: string, kind: MediaKind = 'thumbnail') { return this.jobs.get(`${kind}:${url}`)?.state.src; }

    subscribe(url: string, kind: MediaKind, listener: Listener) {
        const key = `${kind}:${url}`;
        let job = this.jobs.get(key);
        const fresh = !job;
        if (!job) {
            job = { key, url, kind, state: { status: 'queued' }, listeners: new Set(), controller: new AbortController(), attempts: 0 };
            this.jobs.set(key, job);
        }
        const current = job;
        current.listeners.add(listener);
        listener(current.state);
        if (fresh) { this.queues[kind].push(current); this.drain(kind); }
        let subscribed = true;
        return {
            unsubscribe: () => {
                if (!subscribed) return;
                subscribed = false;
                current.listeners.delete(listener);
                if (current.listeners.size) return;
                current.controller.abort();
                clearTimeout(current.timer);
                this.queues[kind] = this.queues[kind].filter(item => item !== current);
                if (current.state.src) URL.revokeObjectURL(current.state.src);
                if (this.jobs.get(key) === current) this.jobs.delete(key);
            },
            retry: () => {
                if (!subscribed || current.state.status !== 'error') return;
                current.attempts = 0;
                this.update(current, { status: 'queued' });
                this.queues[kind].push(current);
                this.drain(kind);
            },
            decodeFailed: () => {
                if (!subscribed || current.state.status !== 'ready') return;
                if (current.state.src) URL.revokeObjectURL(current.state.src);
                this.update(current, { status: 'error', error: 'Image cannot be decoded' });
            }
        };
    }

    private update(job: Job, state: MediaState) {
        job.state = state;
        job.listeners.forEach(listener => listener(state));
    }

    private drain(kind: MediaKind) {
        while (this.active[kind] < this.limits[kind] && this.queues[kind].length) {
            const job = this.queues[kind].shift()!;
            if (job.controller.signal.aborted) continue;
            this.active[kind]++;
            this.update(job, { status: 'loading' });
            void requestAttempt(job.url, { signal: job.controller.signal }, kind === 'thumbnail' ? 15_000 : 60_000, response => response.blob())
                .then(blob => {
                    if (!job.controller.signal.aborted) this.update(job, { status: 'ready', src: URL.createObjectURL(blob) });
                })
                .catch(error => {
                    if (job.controller.signal.aborted) return;
                    if (isRetryable(error) && job.attempts < RETRY_DELAYS.length) {
                        const delay = retryDelay(error, job.attempts++);
                        this.update(job, { status: 'retrying' });
                        job.timer = setTimeout(() => {
                            if (job.controller.signal.aborted) return;
                            this.update(job, { status: 'queued' });
                            this.queues[kind].push(job);
                            this.drain(kind);
                        }, delay);
                    } else this.update(job, { status: 'error', error: error instanceof Error || error instanceof DOMException ? error.message : 'Image unavailable' });
                })
                .finally(() => { this.active[kind]--; this.drain(kind); });
        }
    }
}

export const mediaLoader = new MediaLoader();
