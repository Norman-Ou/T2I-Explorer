import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { imageSize } from 'image-size';
import sharp from 'sharp';
import { requireAssetPath, safeFile } from './dataFormat.js';

type ImageInfo = { mediaType: string; width: number; height: number };
export type OpenMedia = ImageInfo & { handle: FileHandle; key: string; etag: string };
export class MediaError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}

const unavailable = () => new MediaError(404, 'PANEL_UNAVAILABLE', 'The declared panel is unavailable.');
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const RECIPE = 'webp-512-q80-v1';

export class MediaStore {
    private metadata = new Map<string, ImageInfo>();
    private thumbnails = new Map<string, Buffer>();
    private bytes = 0;
    private pending = new Map<string, Promise<Buffer>>();
    private queue: Array<() => void> = [];
    private active = 0;

    async open(root: string, asset: string): Promise<OpenMedia> {
        let handle: FileHandle | undefined;
        try {
            requireAssetPath(asset);
            const file = await safeFile(root, asset);
            handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
            const info = await handle.stat();
            if (!info.isFile() || !info.size || info.size > MAX_IMAGE_BYTES) throw unavailable();
            const key = `${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
            let metadata = this.metadata.get(key);
            if (!metadata) {
                const header = Buffer.alloc(Math.min(12, info.size));
                await handle.read(header, 0, header.length, 0);
                const ext = path.extname(asset).toLowerCase();
                const mediaType = ext === '.png' && header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
                    : ['.jpg', '.jpeg'].includes(ext) && header.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
                    : ext === '.webp' && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
                if (!mediaType) throw unavailable();
                // Most images need only the first block. Grow only for formats with long headers.
                for (let length = Math.min(64 * 1024, info.size); ; length = Math.min(length * 2, info.size)) {
                    const buffer = Buffer.alloc(length);
                    const { bytesRead } = await handle.read(buffer, 0, length, 0);
                    try {
                        const size = imageSize(buffer.subarray(0, bytesRead));
                        if (!size.width || !size.height) throw unavailable();
                        metadata = { mediaType, width: size.width, height: size.height };
                        break;
                    } catch {
                        if (length === info.size || bytesRead < length) throw unavailable();
                    }
                }
                this.metadata.set(key, metadata);
                if (this.metadata.size > 2048) this.metadata.delete(this.metadata.keys().next().value!);
            }
            const etag = `"${createHash('sha256').update(key).digest('hex').slice(0, 32)}-original"`;
            return { ...metadata, handle, key, etag };
        } catch {
            await handle?.close();
            throw unavailable();
        }
    }

    thumbnailEtag(image: OpenMedia) { return image.etag.replace('-original', `-${RECIPE}`); }

    thumbnail(image: OpenMedia): Promise<Buffer> {
        const key = `${image.key}:${RECIPE}`;
        const cached = this.thumbnails.get(key);
        if (cached) {
            this.thumbnails.delete(key);
            this.thumbnails.set(key, cached);
            return Promise.resolve(cached);
        }
        const pending = this.pending.get(key);
        if (pending) return pending;
        if (this.queue.length >= 64) return Promise.reject(new MediaError(503, 'MEDIA_BUSY', 'Image processing is busy. Please retry.'));
        const job = new Promise<Buffer>((resolve, reject) => {
            const queuedAt = Date.now();
            this.queue.push(() => {
                this.active++;
                const convert = async () => {
                    if (Date.now() - queuedAt > 15_000) throw new MediaError(503, 'MEDIA_BUSY', 'Image processing is busy. Please retry.');
                    const transform = sharp().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).timeout({ seconds: 10 });
                    const stream = image.handle.createReadStream({ start: 0, autoClose: false });
                    stream.on('error', error => transform.destroy(error));
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        // Sharp's native timeout starts after input buffering; also bound slow input I/O.
                        const deadline = new Promise<never>((_resolve, reject) => {
                            timer = setTimeout(() => reject(new MediaError(504, 'MEDIA_TIMEOUT', 'Image processing timed out. Please retry.')), 10_000);
                        });
                        const result = await Promise.race([stream.pipe(transform).toBuffer(), deadline]);
                        if (result.length <= CACHE_BYTES) {
                            while (this.bytes + result.length > CACHE_BYTES) {
                                const oldest = this.thumbnails.keys().next().value!;
                                this.bytes -= this.thumbnails.get(oldest)!.length;
                                this.thumbnails.delete(oldest);
                            }
                            this.thumbnails.set(key, result);
                            this.bytes += result.length;
                        }
                        return result;
                    } catch (error) {
                        if (error instanceof MediaError) throw error;
                        if (error instanceof Error && /timeout/i.test(error.message))
                            throw new MediaError(504, 'MEDIA_TIMEOUT', 'Image processing timed out. Please retry.');
                        throw unavailable();
                    } finally {
                        clearTimeout(timer);
                        stream.destroy();
                        transform.destroy();
                    }
                };
                void convert().then(resolve, reject).finally(() => { this.active--; this.drain(); });
            });
            this.drain();
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, job);
        return job;
    }

    private drain() { while (this.active < 2 && this.queue.length) this.queue.shift()!(); }
}
