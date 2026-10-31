// A small static file server for the render CLI and the demo: this
// package's pages and modules (/render.html, /src/, /demo/), three.js at
// /three/, and any other directories mounted under their own prefixes (the
// world at /world/). Only GET and HEAD, and only files inside the mounts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// three's package directory, as Node resolves it from here.
export function threeDir() {
  const main = fileURLToPath(import.meta.resolve("three"));
  return path.resolve(path.dirname(main), "..");
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".ogg": "audio/ogg", ".md": "text/markdown; charset=utf-8",
};

// The file a request path maps to, or null: the longest matching mount,
// then a path that stays inside its directory.
export function resolvePath(mounts, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (!prefix.endsWith("/")) {
      if (decoded === prefix) return path.resolve(mounts[prefix]); // a single file
      continue;
    }
    if (!decoded.startsWith(prefix)) continue;
    const root = path.resolve(mounts[prefix]);
    const file = path.resolve(root, "." + path.posix.normalize("/" + decoded.slice(prefix.length)));
    if (file !== root && !file.startsWith(root + path.sep)) return null;
    return file;
  }
  return null;
}

export const DEFAULT_MOUNTS = () => ({
  "/render.html": path.join(PACKAGE_DIR, "render.html"),
  "/src/": path.join(PACKAGE_DIR, "src"),
  "/demo/": path.join(PACKAGE_DIR, "demo"),
  "/three/": threeDir(),
});

// Starts serving; resolves to { server, url }. `mounts`: { "/prefix/": dir }
// (or { "/name": file }) added to DEFAULT_MOUNTS. "/" redirects to /demo/.
export function serve(mounts = {}, { host = "127.0.0.1", port = 0 } = {}) {
  const all = { ...DEFAULT_MOUNTS(), ...mounts };
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/") {
      res.writeHead(302, { location: "/demo/" }).end();
      return;
    }
    let file = resolvePath(all, req.url);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` }));
  });
}
