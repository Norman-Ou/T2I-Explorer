import { expect, it } from 'vitest';
import { imageExtension } from '../tools/image-extension.js';
it('uses encoded format for migrated asset names, preserving source bytes when extensions disagree', () => {
    const jpeg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
    expect(imageExtension(jpeg)).toBe('.jpg');
    expect(imageExtension(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('.png');
    expect(() => imageExtension(Buffer.from('no image'))).toThrow();
});
