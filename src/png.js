// A small PNG decoder that returns the stored bytes as they are.
//
// Browsers decode images premultiplied by alpha in places (a 2D canvas
// always, an <img> in Safari), which zeroes the colour wherever alpha is 0.
// Terrain control maps keep the fourth splat weight in alpha, so that would
// wipe out the other three weights (see docs/SHADERS.md, "Terrain"); grass
// densities are counts, not colours. They go through here instead.
//
// Handles what UnityPackFF and PIL write, and more: every colour type, bit
// depths 1–16 (16-bit samples keep their high byte), palettes with tRNS.
// Interlaced (Adam7) images are rejected. Inflating uses the platform's
// DecompressionStream, which browsers and Node ≥ 18 have.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The chunks of a PNG file: header fields, palette, transparency, and the
// image data joined. Throws on anything that isn't a PNG it can decode.
export function readChunks(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8 || SIGNATURE.some((v, i) => b[i] !== v)) throw new Error("not a PNG file");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 8;
  let header = null, palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= b.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, pos + 8 + length);
    if (data.length !== length) throw new Error(`PNG chunk ${type} is cut short`);
    pos += 12 + length; // length, type, data, CRC
    if (type === "IHDR") {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      header = { width: d.getUint32(0), height: d.getUint32(4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error("PNG file has no IHDR chunk");
  if (!(header.colorType in CHANNELS)) throw new Error(`PNG colour type ${header.colorType} is not valid`);
  if (header.interlace) throw new Error("interlaced PNG files are not supported");
  if (header.colorType === 3 && !palette) throw new Error("palette PNG file has no PLTE chunk");
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  return { ...header, palette, trns, data: joined };
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undoes the per-row filters in place; returns the rows without their filter bytes.
export function unfilter(raw, width, height, bitsPerPixel) {
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < height * (stride + 1)) throw new Error("PNG image data is cut short");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[up + x] : 0;
      const c = x >= bpp && y > 0 ? out[up + x - bpp] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`PNG row filter ${filter} is not valid`);
      }
      out[row + x] = r & 255;
    }
  }
  return out;
}

// Image rows (unfiltered) as RGBA, 8 bits per channel.
export function toRgba({ width, height, depth, colorType, palette, trns }, rows) {
  const channels = CHANNELS[colorType];
  const stride = Math.ceil((width * channels * depth) / 8);
  const out = new Uint8Array(width * height * 4);
  const maxv = (1 << Math.min(depth, 8)) - 1;
  // A sample as 0–255 (palette indices as they are).
  const sample = (row, i) => {
    if (depth === 8) return rows[row + i];
    if (depth === 16) return rows[row + i * 2];
    const bit = i * depth, byte = rows[row + (bit >> 3)];
    const v = (byte >> (8 - depth - (bit & 7))) & maxv;
    return colorType === 3 ? v : Math.round((v * 255) / maxv);
  };
  // The transparent colour of grey and RGB images, compared in stored units.
  const key = trns && colorType !== 3 ? Array.from({ length: trns.length >> 1 }, (_, i) => (trns[i * 2] << 8) | trns[i * 2 + 1]) : null;
  const raw = (row, i) => (depth === 16 ? (rows[row + i * 2] << 8) | rows[row + i * 2 + 1] : depth === 8 ? rows[row + i] : (() => {
    const bit = i * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxv;
  })());
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      switch (colorType) {
        case 0: {
          const g = sample(row, s);
          out[o] = out[o + 1] = out[o + 2] = g;
          out[o + 3] = key && raw(row, s) === key[0] ? 0 : 255;
          break;
        }
        case 2:
          out[o] = sample(row, s); out[o + 1] = sample(row, s + 1); out[o + 2] = sample(row, s + 2);
          out[o + 3] = key && raw(row, s) === key[0] && raw(row, s + 1) === key[1] && raw(row, s + 2) === key[2] ? 0 : 255;
          break;
        case 3: {
          const i = sample(row, s);
          out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2];
          out[o + 3] = trns && i < trns.length ? trns[i] : 255;
          break;
        }
        case 4:
          out[o] = out[o + 1] = out[o + 2] = sample(row, s);
          out[o + 3] = sample(row, s + 1);
          break;
        case 6:
          out[o] = sample(row, s); out[o + 1] = sample(row, s + 1); out[o + 2] = sample(row, s + 2); out[o + 3] = sample(row, s + 3);
          break;
      }
    }
  }
  return out;
}

// Decodes a PNG file (ArrayBuffer or Uint8Array) to { width, height, data },
// data being RGBA bytes, top row first, never premultiplied.
export async function decodePng(bytes) {
  const info = readChunks(bytes);
  const rows = unfilter(await inflate(info.data), info.width, info.height, CHANNELS[info.colorType] * info.depth);
  return { width: info.width, height: info.height, data: toRgba(info, rows) };
}

// Resamples RGBA bytes to size × size: each output pixel averages the source
// pixels it covers (shrinking), or interpolates between them (growing).
export function resizeRgba({ width, height, data }, size) {
  if (width === size && height === size) return data;
  const out = new Uint8Array(size * size * 4);
  const fx = width / size, fy = height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (fx >= 1 && fy >= 1) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
        const n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += data[(yy * width + xx) * 4 + c];
          out[o + c] = Math.round(s / n);
        }
      } else {
        // texel centres; wrap around, as tiled textures do
        const sx = (x + 0.5) * fx - 0.5, sy = (y + 0.5) * fy - 0.5;
        const ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy;
        const at = (xx, yy, c) => data[((((yy % height) + height) % height) * width + (((xx % width) + width) % width)) * 4 + c];
        for (let c = 0; c < 4; c++) {
          const top = at(ix, iy, c) * (1 - tx) + at(ix + 1, iy, c) * tx;
          const bottom = at(ix, iy + 1, c) * (1 - tx) + at(ix + 1, iy + 1, c) * tx;
          out[o + c] = Math.round(top * (1 - ty) + bottom * ty);
        }
      }
    }
  }
  return out;
}
