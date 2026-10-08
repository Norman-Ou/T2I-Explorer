export class RequestError extends Error {
    constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}

export const RETRY_DELAYS = [500, 1500] as const;
export function isRetryable(error: unknown) {
    return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
        || (error instanceof RequestError && (error.status === 429 || error.status >= 500));
}
export function retryDelay(error: unknown, attempt: number) {
    return Math.max(RETRY_DELAYS[attempt] ?? 0, error instanceof RequestError ? error.retryAfter : 0);
}

export async function requestAttempt<T>(url: RequestInfo | URL, init: RequestInit, timeout: number, read: (response: Response) => Promise<T>): Promise<T> {
    init.signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        const work = fetch(url, { ...init, signal: controller.signal }).then(async response => {
            if (!response.ok) {
                const body = await response.json().catch(() => undefined);
                const message = typeof body?.error?.message === 'string' ? body.error.message : `Request failed with status ${response.status}`;
                const header = response.headers.get('Retry-After');
                const delay = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
                throw new RequestError(message, response.status, Number.isFinite(delay) ? Math.max(0, delay) : 0);
            }
            return read(response);
        });
        return await Promise.race([work, aborted]);
    } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', onAbort);
    }
}

export function backoff(delay: number, signal?: AbortSignal | null): Promise<void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, delay);
        signal?.addEventListener('abort', cancel, { once: true });
    });
}
