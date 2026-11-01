import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeJob, areaTiles, areaBounds, stableJson, validName } from "../src/jobs.js";
import { planJobs, worldFingerprint, jobKey, worldTiles } from "../cli/render.mjs";
import { resolvePath } from "../cli/server.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ff-three-test-"));

test("jobs get their defaults and are checked", () => {
  assert.deepEqual(normalizeJob({ type: "topdown", tile: "04_02", name: "x", extra: 1 }), { type: "topdown", size: 1024, tile: "04_02" });
  const v = normalizeJob({ type: "view", area: [4, 2, 4, 2] });
  assert.deepEqual(v.tiles, ["03_01", "04_01", "05_01", "03_02", "04_02", "05_02", "03_03", "04_03", "05_03"]);
  assert.deepEqual([v.sky, v.width, v.height, v.pitch], ["normal", 1280, 720, 26]);
  assert.throws(() => normalizeJob({ type: "topdown", tile: "../x" }), /XX_YY/);
  assert.throws(() => normalizeJob({ type: "view", area: [4, 2, 3, 2] }), /area/);
  assert.throws(() => normalizeJob({ type: "view", area: [4, 2, 4, 2], sky: "red" }), /sky/);
  assert.throws(() => normalizeJob({ type: "spin" }), /unknown/);
  assert.deepEqual(areaTiles([0, 0, 0, 0], 1), ["00_00", "01_00", "00_01", "01_01"]);
  assert.deepEqual(areaBounds([4, 2, 4, 2]), [-2560, -2048, 1024, 1536]);
});

test("job keys change with the job, the world and ff-three", () => {
  const job = normalizeJob({ type: "topdown", tile: "04_02" });
  assert.equal(stableJson({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
  const k = jobKey(job, "w1", "0.1.0");
  assert.equal(k, jobKey({ ...job }, "w1", "0.1.0"));
  assert.notEqual(k, jobKey({ ...job, size: 512 }, "w1", "0.1.0"));
  assert.notEqual(k, jobKey(job, "w2", "0.1.0"));
  assert.notEqual(k, jobKey(job, "w1", "0.2.0"));
});

test("the world's fingerprint and tiles", () => {
  const dir = tmp();
  assert.equal(worldFingerprint(dir), null);
  fs.mkdirSync(path.join(dir, "tile"));
  for (const t of ["01_02", "00_00"]) fs.writeFileSync(path.join(dir, "tile", `${t}.glb`), "");
  fs.writeFileSync(path.join(dir, "tile", "notes.txt"), "");
  assert.deepEqual(worldTiles(dir), ["00_00", "01_02"]);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ created: "now", tiles: { "05_05": {} } }));
  assert.match(worldFingerprint(dir), /^[0-9a-f]{64}$/);
  assert.deepEqual(worldTiles(dir), ["05_05"]);
  // ff-unpack's own fingerprint wins over the file's hash (which its timestamp changes)
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ created: "later", fingerprint: "abc", tiles: [] }));
  assert.equal(worldFingerprint(dir), "abc");
});

test("planning names jobs and refuses bad names", () => {
  const dir = tmp();
  const jobs = path.join(dir, "jobs.json");
  fs.writeFileSync(jobs, JSON.stringify([{ name: "candy", type: "view", area: [8, 5, 8, 5] }]));
  const plan = planJobs({ jobsFile: jobs, topdown: "04_02,04_03", size: 512, worldDir: dir });
  assert.deepEqual(plan.map((j) => j.name), ["candy", "04_02", "04_03"]);
  assert.equal(plan[1].job.size, 512);
  fs.writeFileSync(jobs, JSON.stringify([{ name: "../evil", type: "topdown", tile: "00_00" }]));
  assert.throws(() => planJobs({ jobsFile: jobs, worldDir: dir }), /job name/);
  fs.writeFileSync(jobs, JSON.stringify([{ name: "a", type: "topdown", tile: "00_00" }, { name: "a", type: "topdown", tile: "00_01" }]));
  assert.throws(() => planJobs({ jobsFile: jobs, worldDir: dir }), /two jobs/);
  assert.ok(validName("03_01-04_02.v2"));
  assert.ok(!validName(".hidden") && !validName("a/b") && !validName(""));
});

test("the server stays inside its mounts", () => {
  const mounts = { "/world/": "/srv/world", "/render.html": "/pkg/render.html" };
  assert.equal(resolvePath(mounts, "/world/tile/04_02.glb?x=1"), path.resolve("/srv/world/tile/04_02.glb"));
  assert.equal(resolvePath(mounts, "/world/../../etc/passwd"), path.resolve("/srv/world/etc/passwd"));
  assert.equal(resolvePath(mounts, "/world/%2e%2e/%2e%2e/etc/passwd"), path.resolve("/srv/world/etc/passwd"));
  assert.equal(resolvePath(mounts, "/render.html?job=1"), path.resolve("/pkg/render.html"));
  assert.equal(resolvePath(mounts, "/render.html/x"), null);
  assert.equal(resolvePath(mounts, "/elsewhere"), null);
  assert.equal(resolvePath(mounts, "/world/%zz"), null);
});

test("the demo server lists models and worlds with their named areas", async () => {
  const { indexFiles } = await import("../cli/serve.mjs");
  const root = tmp();
  const put = (rel, text = "") => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put("loose/grim.glb"); put("loose/grim@stand1.glb");
  put("pack/models/manifest.json", "{}"); put("pack/models/mob/drum/drum.glb"); put("pack/models/mob/drum/clips/run.glb"); put("pack/models/shared/abc.bin");
  put("pack/avatar/manifest.json", "{}"); put("pack/avatar/wear/hat/hat.glb");
  put("pack/world/tile/04_02.glb"); put("pack/world/tile/03_01.glb"); put("pack/world/shared/x.png");
  put("pack/.world-staging/world/tile/04_02.glb"); // a sub-pack being written: hidden, left out
  put("pack/areas/areas.json", JSON.stringify([
    { name: "Orchid Bay", zone: "Downtown", x: 1536, y: 512, width: 512, height: 512 },
    { name: "Orchid Bay", zone: "Downtown", x: 2048, y: 1024, width: 512, height: 512 },
    { name: "Elsewhere", zone: "Nowhere", x: 7680, y: 7680, width: 512, height: 512 },
  ]));
  // the client's tables: NPC 1 uses the drum, hat 1 and 2 the same model in two textures
  put("pack/models/tables.json", JSON.stringify({ m_pNpcTable: {
    m_pNpcData: [{}, { m_iNpcName: 1, m_iMesh: 1, m_iTexture: 0 }],
    m_pNpcMeshData: [{}, { m_pstrMMeshModelString: "drum", m_pstrMTextureString: "drum" }],
    m_pNpcStringData: [{}, { m_strName: "Barrel Buster" }],
  } }));
  put("pack/avatar/tables.json", JSON.stringify({ m_pHatItemTable: {
    m_pItemData: [{}, { m_iItemName: 1, m_iMesh: 1, m_iTexture: 0 }, { m_iItemName: 2, m_iMesh: 2, m_iTexture: 0 }],
    m_pItemMeshData: [{}, { m_pstrMMeshModelString: "hat", m_pstrMTextureString: "hat" }, { m_pstrMMeshModelString: "hat", m_pstrMTextureString: "hat_b" }],
    m_pItemStringData: [{}, { m_strName: "Fox Hat" }, { m_strName: "Bear Hat" }],
  } }));
  put("pack/avatar/wear/hat/hat_b.glb");
  const index = indexFiles(root, "/files/");
  assert.deepEqual(index.models.map((m) => [m.url, m.group, m.name, m.clips, m.names]), [
    ["/files/loose/grim.glb", "loose", "grim.glb", null, undefined],
    // each texture variant named by the items that use it
    ["/files/pack/avatar/wear/hat/hat.glb", "pack/avatar/wear", "hat/hat.glb", null, ["Fox Hat"]],
    ["/files/pack/avatar/wear/hat/hat_b.glb", "pack/avatar/wear", "hat/hat_b.glb", null, ["Bear Hat"]],
    ["/files/pack/models/mob/drum/drum.glb", "pack/models/mob", "drum/drum.glb", "pack", ["Barrel Buster"]],
  ]);
  assert.equal(index.worlds.length, 1);
  assert.equal(index.worlds[0].url, "/files/pack/world/");
  assert.deepEqual(index.worlds[0].tiles.sort(), ["03_01", "04_02"]);
  // two rectangles, one area; areas without a tile here are left out
  assert.deepEqual(index.worlds[0].areas, [{ name: "Orchid Bay", zone: "Downtown", area: [3, 1, 4, 2] }]);
});
