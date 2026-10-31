// Test data made here, never taken from the game: PNG files of every kind
// png.js reads, and a small world tile shaped like UnityPackFF's output.
import zlib from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// A PNG file from rows of packed samples (`rows`: Uint8Array per row, as
// the PNG stores them before filtering), filtering row y with
// filters[y % filters.length].
export function encodePng({ width, height, depth = 8, colorType = 6, rows, palette = null, trns = null, filters = [0], interlace = 0 }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    raw[y * (stride + 1)] = f;
    const row = rows[y], up = y > 0 ? rows[y - 1] : new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up[x], c = x >= bpp ? up[x - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      raw[y * (stride + 1) + 1 + x] = (row[x] - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(palette ? [chunk("PLTE", palette)] : []),
    ...(trns ? [chunk("tRNS", trns)] : []),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// An 8-bit RGBA PNG from RGBA bytes (top row first).
export function rgbaPng(width, height, rgba, filters = [0, 1, 2, 3, 4]) {
  const rows = Array.from({ length: height }, (_, y) => rgba.subarray(y * width * 4, (y + 1) * width * 4));
  return encodePng({ width, height, rows, filters });
}

// A solid-colour RGBA PNG.
export function solidPng(size, [r, g, b, a = 255]) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([r, g, b, a], i * 4);
  return rgbaPng(size, size, data);
}

// A GLB from a glTF JSON document and one binary chunk.
export function glb(json, bin) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const js = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const bb = pad(Buffer.from(bin), 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8);
  const h = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, h(js.length, 0x4e4f534a), js, h(bb.length, 0x004e4942), bb]);
}

// A world tile as UnityPackFF writes one, small: tile (tx, ty) at its world
// position, a flat 512 m terrain at height `ground` (two splats: red under
// the west half, blue under the east half, by one control map; a white
// lightmap), a normal_* prop (a green box, 40 m, in the middle), and the
// scene's extras. Shared images go to `shared` (name → bytes) and are
// pointed to as ../shared/<name>, as in a world pack.
export function makeTile(tx, ty, { ground = 0, W = 9 } = {}) {
  const bin = [];
  let offset = 0;
  const views = [], accessors = [];
  const add = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    bin.push(padded);
    offset += padded.length;
    return views.length - 1;
  };
  const accessor = (typed, type, componentType, minmax = false) => {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: add(typed, componentType === 5123 || componentType === 5125 ? 34963 : 34962), componentType, count: typed.length / n, type };
    if (minmax) {
      acc.min = Array.from({ length: n }, (_, i) => Math.min(...typed.filter((_, j) => j % n === i)));
      acc.max = Array.from({ length: n }, (_, i) => Math.max(...typed.filter((_, j) => j % n === i)));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // terrain: vertex z·W + x, x mirrored, uv = (x, z) / size with v flipped
  const pos = [], uv = [], idx = [];
  const size = 512, step = size / (W - 1);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) { pos.push(-x * step, 0, z * step); uv.push(x / (W - 1), 1 - z / (W - 1)); }
  for (let z = 0; z < W - 1; z++) for (let x = 0; x < W - 1; x++) {
    const a = z * W + x, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, d, c, a, b, d); // wound for the mirror: faces up
  }
  const normals = [];
  for (let i = 0; i < W * W; i++) normals.push(0, 1, 0);
  const terrainMesh = {
    name: "terrain",
    primitives: [{
      attributes: {
        POSITION: accessor(new Float32Array(pos), "VEC3", 5126, true),
        NORMAL: accessor(new Float32Array(normals), "VEC3", 5126),
        TEXCOORD_0: accessor(new Float32Array(uv), "VEC2", 5126),
      },
      indices: accessor(new Uint16Array(idx), "SCALAR", 5123),
      material: 0,
    }],
  };

  // a box, 40 m
  const bp = [], bn = [], bu = [], bi = [];
  const faces = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of faces) {
    const [ux, uy, uz] = n[1] !== 0 ? [1, 0, 0] : [0, 1, 0];
    const v = [n[1] * uz - n[2] * uy, n[2] * ux - n[0] * uz, n[0] * uy - n[1] * ux];
    const base = bp.length / 3;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      bp.push(20 * (n[0] + s * ux + t * v[0]), 20 * (n[1] + s * uy + t * v[1]) + 20, 20 * (n[2] + s * uz + t * v[2]));
      bn.push(...n);
      bu.push((s + 1) / 2, (t + 1) / 2);
    }
    bi.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const boxMesh = {
    name: "box",
    primitives: [{
      attributes: {
        POSITION: accessor(new Float32Array(bp), "VEC3", 5126, true),
        NORMAL: accessor(new Float32Array(bn), "VEC3", 5126),
        TEXCOORD_0: accessor(new Float32Array(bu), "VEC2", 5126),
      },
      indices: accessor(new Uint16Array(bi), "SCALAR", 5123),
      material: 1,
    }],
  };

  // control map: weight 1 for splat 0 (red) in the west half (glTF +x side
  // of the tile, Unity's low x: the image's left half), splat 1 (blue) east
  const C = 16, control = new Uint8Array(C * C * 4);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) control.set(x < C / 2 ? [255, 0, 0, 0] : [0, 255, 0, 0], (y * C + x) * 4);
  const shared = {
    "red.png": solidPng(8, [200, 0, 0]),
    "blue.png": solidPng(8, [0, 0, 200]),
    "control.png": rgbaPng(C, C, control),
    "lightmap.png": solidPng(8, [255, 255, 255]),
    "green.png": solidPng(8, [128, 255, 128]),
  };
  const names = Object.keys(shared);
  const images = names.map((n) => ({ name: n, mimeType: "image/png", uri: `../shared/${n}` }));
  const textures = names.map((_, i) => ({ source: i, sampler: 0 }));
  const tex = (n) => names.indexOf(n);

  const json = {
    asset: { version: "2.0", generator: "ff-three tests" },
    scene: 0,
    scenes: [{
      nodes: [0],
      extras: {
        render_settings: { fog: false, fog_color: [0.5, 0.5, 0.5, 1], fog_density: 0.01, ambient: [0.2, 0.2, 0.2, 1] },
        colors: { fog_depth: 0.5, fog: [0.4, 0.7, 1, 1], sky: [0, 0, 0.8, 1], light: [1, 1, 1, 1] },
      },
    }],
    nodes: [
      { name: `Map_${String(tx).padStart(2, "0")}_${String(ty).padStart(2, "0")}`, translation: [-tx * 512, 0, ty * 512], children: [1, 2] },
      { name: "Terrain", translation: [0, ground, 0], mesh: 0 },
      { name: "box", translation: [-256, ground, 256], mesh: 1 },
    ],
    meshes: [terrainMesh, boxMesh],
    materials: [
      {
        name: "terrain",
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
        extras: { terrain: {
          splats: [{ texture: tex("red.png"), tile_size: [16, 16], tile_offset: [0, 0] }, { texture: tex("blue.png"), tile_size: [16, 16], tile_offset: [0, 0] }],
          controls: [tex("control.png")],
          lightmap: tex("lightmap.png"),
        } },
      },
      {
        name: "box",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: tex("green.png") }, metallicFactor: 0, roughnessFactor: 1 },
        extras: {
          shader: "normal_blendSrcalphaInvsrcalpha",
          colors: { _Color: [0.3, 0.3, 0.3, 1], _AmbColor: [0.3, 0.3, 0.3, 1], _Emission: [0.25, 0.25, 0.25, 1] },
          floats: {},
          textures: { _MainTex: { texture: "green", scale: [1, 1], offset: [0, 0] } },
        },
      },
    ],
    textures,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  return { glb: glb(json, Buffer.concat(bin)), shared };
}
