import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaPanels } from '../src/client/MediaPanels.js';
import type { SampleView } from '../src/shared/contracts.js';
beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('image'))));
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:image'; static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const record: SampleView = { sample_id: 'A', index: 1, input_text: null, pred_text: null, gt_text: null, metadata: {}, panels: [{ id: 'original', title: 'Original', status: 'available', url: '/original.png', thumbnail_url: '/original.png?variant=thumbnail' }, { id: 'mask', title: 'Mask', status: 'missing', unavailable_reason: 'Not supplied' }] };
it('opens the full sample from any available panel and preserves unavailable positions', () => {
    const open = vi.fn();
    const { container } = render(<MediaPanels record={record} onOpen={open}/>);
    expect(container.querySelector('.media-panels')).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' });
    fireEvent.click(screen.getByRole('button', { name: 'Open all 2 panels for A: Original' }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText('Not supplied')).toBeInTheDocument();
});
it('renders all modal panels without nested open controls and handles decode errors', async () => {
    render(<MediaPanels record={record}/>);
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.error(await screen.findByRole('img'));
    expect(screen.getByText('Image cannot be decoded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Original' })).toBeInTheDocument();
});

it('fetches thumbnails in comparison cells and originals in the detail view', async () => {
    const preview = render(<MediaPanels record={record} onOpen={vi.fn()}/>);
    await screen.findByRole('img');
    expect(fetch).toHaveBeenCalledWith('/original.png?variant=thumbnail', expect.anything());
    preview.unmount();
    render(<MediaPanels record={record}/>);
    await screen.findByRole('img');
    expect(fetch).toHaveBeenCalledWith('/original.png', expect.anything());
});

it('retries only the failed panel without opening the details or nesting buttons', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('missing', { status: 404 }));
    const open = vi.fn();
    const { container } = render(<MediaPanels record={record} onOpen={open}/>);
    const retry = await screen.findByRole('button', { name: 'Retry Original' });
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole('img');
    expect(open).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('waits for viewport visibility and cancels an abandoned image request', async () => {
    let enter: IntersectionObserverCallback = () => {};
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { enter = callback; } observe() {} disconnect() {} });
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<MediaPanels record={record} onOpen={vi.fn()}/>);
    expect(fetch).not.toHaveBeenCalled();
    const { act } = await import('@testing-library/react');
    act(() => enter([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
});
