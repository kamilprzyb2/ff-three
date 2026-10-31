#!/usr/bin/env node
// Screenshots a page of the demo server in headless Chromium, for checking
// the viewers by eye: node dev/shot.mjs --dir <files> --page "/demo/?model=/files/x.glb" --out shot.png [--wait 8]
// Prints the page's console errors.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "../cli/server.mjs";
import { browser } from "../cli/render.mjs";

const { values } = parseArgs({ options: {
  dir: { type: "string" }, page: { type: "string" }, out: { type: "string" }, wait: { type: "string", default: "8" },
  width: { type: "string", default: "1200" }, height: { type: "string", default: "900" }, eval: { type: "string" },
} });
const { server, url } = await serve(values.dir ? { "/files/": path.resolve(values.dir) } : {});
const b = await browser(process.env.CHROME, [+values.width, +values.height]);
try {
  await b.send("Runtime.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: +values.width, height: +values.height, deviceScaleFactor: 1, mobile: false });
  await b.send("Page.navigate", { url: url + values.page });
  await new Promise((r) => setTimeout(r, +values.wait * 1000));
  if (values.eval) {
    console.log(await b.evaluate(values.eval));
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("status:", await b.evaluate("document.getElementById('status') && document.getElementById('status').textContent"));
  const shot = await b.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(values.out, Buffer.from(shot.result.data, "base64"));
} finally {
  b.close();
  server.close();
}
