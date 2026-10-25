import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

/** Read the actual exported PNG pixels, independently of the atlas encoder. */
export function decodePng(bytes: Uint8Array) {
  const source = Buffer.from(bytes);
  assert.deepEqual([...source.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed: Buffer[] = [];
  let width = 0, height = 0, channels = 0;
  for (let offset = 8; offset < source.length;) {
    const size = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'The atlas must use supported 8-bit pixels');
      assert([2, 6].includes(data[9]), 'Expected an RGB or RGBA atlas');
      channels = data[9] === 6 ? 4 : 3;
      assert.equal(data[12], 0, 'Expected a non-interlaced atlas');
    }
    if (type === 'IDAT') compressed.push(data);
    offset += size + 12;
  }
  assert(width > 0 && height > 0 && compressed.length > 0, 'PNG must contain pixels');
  const scanlines = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  assert.equal(scanlines.length, height * (stride + 1));
  const pixels = new Uint8Array(width * height * channels);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (stride + 1)];
    assert(filter <= 4, 'Unknown PNG row filter');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? pixels[at - channels] : 0;
      const above = y > 0 ? pixels[at - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[at - stride - channels] : 0;
      const prediction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      pixels[at] = (scanlines[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels, pixel(x: number, y: number) {
    assert(x >= 0 && x < width && y >= 0 && y < height, 'UV must address an atlas pixel');
    return [...pixels.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
  } };
}
