#!/usr/bin/env node
// ff-three-render: renders world pictures (src/render.js jobs) in headless
// Chromium, through the DevTools protocol (Node 22's WebSocket).
//
//   ff-three-render --world <dir> --out <dir> [--jobs jobs.json] [--topdown all|XX_YY,…]
//                   [--size 1024] [--browsers 1] [--chrome <path>] [--force]
//
// Each job writes <out>/<name>.png. <out>/renders.json records, per name,
// the job and a key (the job, ff-three's version and the world's
// fingerprint): a job whose picture exists with the same key is skipped, so
// an interrupted run resumes and a changed job, world or ff-three is redone.
// Jobs that fail (software GL now and then loses its context) are retried
// in later rounds with one browser. Exit status 1 if any job is left undone.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serve, PACKAGE_DIR } from "./server.mjs";
import { normalizeJob, stableJson, validName } from "../src/jobs.js";

const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The world's fingerprint: its manifest's own (ff-unpack's, from the
// sources' hashes), else the manifest's SHA-256, or null without one.
export function worldFingerprint(worldDir) {
  const f = path.join(worldDir, "manifest.json");
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f);
  try {
    const own = JSON.parse(text).fingerprint;
    if (typeof own === "string" && own) return own;
  } catch {
    // not JSON: hash it as it is
  }
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function jobKey(job, fingerprint, version = VERSION) {
  return crypto.createHash("sha256").update(stableJson({ job, world: fingerprint, ff_three: version })).digest("hex").slice(0, 32);
}

// The tiles of a world directory: its manifest's, or the tile/ files.
export function worldTiles(worldDir) {
  const f = path.join(worldDir, "manifest.json");
  if (fs.existsSync(f)) {
    const tiles = JSON.parse(fs.readFileSync(f, "utf8")).tiles;
    if (tiles) return (Array.isArray(tiles) ? tiles : Object.keys(tiles)).sort();
  }
  const dir = path.join(worldDir, "tile");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^\d+_\d+\.glb$/.test(n)).map((n) => n.slice(0, -4)).sort() : [];
}

// Named jobs from the options: a jobs file ([{ name, type, … }]) and
// --topdown keys (named after the tile).
export function planJobs({ jobsFile = null, topdown = null, size = null, worldDir }) {
  const jobs = [];
  if (jobsFile) {
    const list = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
    if (!Array.isArray(list)) throw new Error(`${jobsFile}: expected a JSON array of jobs`);
    jobs.push(...list);
  }
  if (topdown) {
    const keys = topdown === "all" ? worldTiles(worldDir) : topdown.split(",").map((s) => s.trim()).filter(Boolean);
    for (const tile of keys) jobs.push({ name: tile, type: "topdown", tile, ...(size ? { size } : {}) });
  }
  const names = new Set();
  return jobs.map((j) => {
    if (!validName(j.name)) throw new Error(`job name ${JSON.stringify(j.name)}: letters, digits, _ - . only`);
    if (names.has(j.name)) throw new Error(`two jobs are named ${j.name}`);
    names.add(j.name);
    return { name: j.name, job: normalizeJob(j) };
  });
}

function readRecord(out) {
  try {
    return JSON.parse(fs.readFileSync(path.join(out, "renders.json"), "utf8"));
  } catch {
    return { renders: {} };
  }
}

function writeRecord(out, record) {
  const tmp = path.join(out, `.renders.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(record, null, 1) + "\n");
  fs.renameSync(tmp, path.join(out, "renders.json"));
}

// Browsers still running, killed when this process ends however it ends.
const running = new Set();
process.once("exit", () => { for (const p of running) p.kill(); });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => process.exit(130));

export async function browser(chrome, windowSize) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ff-three-chrome-"));
  const proc = spawn(chrome, [
    "--headless", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    `--window-size=${windowSize[0]},${windowSize[1]}`, "about:blank",
  ], { stdio: "ignore" });
  running.add(proc);
  const close = () => {
    running.delete(proc);
    proc.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  };
  let ws = null;
  for (let i = 0; i < 120 && !ws; i++) {
    await sleep(250);
    try {
      const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
      const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // not up yet
    }
  }
  if (!ws) {
    close();
    throw new Error(`the browser did not start (${chrome})`);
  }
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
  await send("Page.enable");
  return { send, evaluate, close: () => { ws.close(); close(); } };
}

// Renders `todo` ([{ name, job, key }]) with one browser; calls done(item)
// after each picture is written.
async function worker(chrome, base, out, todo, windowSize, timeout, done) {
  const b = await browser(chrome, windowSize);
  try {
    for (const item of todo) {
      const t0 = Date.now();
      await b.send("Page.navigate", { url: `${base}/render.html?world=/world/&job=${encodeURIComponent(JSON.stringify(item.job))}` });
      let finished = false;
      while (!finished && Date.now() - t0 < timeout) {
        await sleep(250);
        finished = await b.evaluate("!!window.__done");
      }
      const err = finished ? await b.evaluate("window.__err || null") : "timeout";
      const png = !err ? await b.evaluate("window.__png || null") : null;
      if (!png || !png.startsWith("data:image/png;base64,")) {
        console.log(`  ${item.name}: ${err ? err.split("\n").slice(0, 4).join("\n    ") : "no picture"}; retrying later`);
      } else {
        const file = path.join(out, `${item.name}.png`);
        fs.writeFileSync(file + ".tmp", Buffer.from(png.slice(png.indexOf(",") + 1), "base64"));
        fs.renameSync(file + ".tmp", file);
        console.log(`  ${item.name} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        done(item);
      }
      await b.send("Page.navigate", { url: "about:blank" });
    }
  } finally {
    b.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      world: { type: "string" }, out: { type: "string" }, jobs: { type: "string" }, topdown: { type: "string" },
      size: { type: "string" }, browsers: { type: "string", default: "1" }, chrome: { type: "string" },
      force: { type: "boolean", default: false }, timeout: { type: "string", default: "300" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !values.world || !values.out || (!values.jobs && !values.topdown)) {
    console.log("usage: ff-three-render --world <dir> --out <dir> [--jobs jobs.json] [--topdown all|XX_YY,…] [--size N]\n" +
      "                       [--browsers N] [--chrome <path>] [--timeout <s>] [--force]\n" +
      "Chromium comes from --chrome or $CHROME.");
    return values.help ? 0 : 2;
  }
  const chrome = values.chrome || process.env.CHROME;
  if (!chrome) throw new Error("no browser: pass --chrome or set CHROME");
  const worldDir = path.resolve(values.world), out = path.resolve(values.out);
  fs.mkdirSync(out, { recursive: true });
  const fingerprint = worldFingerprint(worldDir);
  const jobs = planJobs({ jobsFile: values.jobs, topdown: values.topdown, size: values.size ? Number(values.size) : null, worldDir })
    .map((j) => ({ ...j, key: jobKey(j.job, fingerprint) }));
  const record = readRecord(out);
  record.ff_three = VERSION;
  record.world = fingerprint;
  record.renders = record.renders || {};
  const isDone = (j) => !values.force && record.renders[j.name]?.key === j.key && fs.existsSync(path.join(out, `${j.name}.png`));
  const skipped = jobs.filter(isDone).length;
  console.log(`${jobs.length} jobs, ${skipped} already rendered`);
  const windowSize = jobs.reduce(([w, h], { job }) => [Math.max(w, job.width || job.size || 0), Math.max(h, job.height || job.size || 0)], [800, 600]);

  const { server, url } = await serve({ "/world/": worldDir });
  const finished = new Set();
  try {
    for (let round = 0; round < 5; round++) {
      const todo = jobs.filter((j) => !isDone(j) && !finished.has(j.name));
      if (!todo.length) break;
      const n = round ? 1 : Math.max(1, Math.min(Number(values.browsers) || 1, todo.length));
      const lists = Array.from({ length: n }, () => []);
      todo.forEach((j, i) => lists[i % n].push(j));
      await Promise.all(lists.map((list) => worker(chrome, url, out, list, windowSize, Number(values.timeout) * 1000, (item) => {
        finished.add(item.name);
        record.renders[item.name] = { job: item.job, key: item.key, rendered: new Date().toISOString() };
        writeRecord(out, record);
      })));
    }
  } finally {
    server.close();
  }
  writeRecord(out, record);
  const missing = jobs.filter((j) => !isDone(j) && !finished.has(j.name));
  if (missing.length) {
    console.log(`not rendered: ${missing.map((j) => j.name).join(" ")}`);
    return 1;
  }
  return 0;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message || e); process.exit(2); });
}
