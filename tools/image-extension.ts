export function imageExtension(bytes: Uint8Array): '.png' | '.jpg' | '.webp' {
    const hex = Buffer.from(bytes).subarray(0, 12).toString('hex');
    if (hex.startsWith('89504e470d0a1a0a'))
        return '.png';
    if (hex.startsWith('ffd8ff'))
        return '.jpg';
    if (Buffer.from(bytes).toString('ascii', 0, 4) === 'RIFF' && Buffer.from(bytes).toString('ascii', 8, 12) === 'WEBP')
        return '.webp';
    throw new Error('Unsupported original image encoding');
}
