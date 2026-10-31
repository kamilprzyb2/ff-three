#!/usr/bin/env node
// Serves the demo page (at /demo/) and, with --dir, a directory of
// UnityPackFF output at /files/: open /demo/?model=/files/<model>.glb or
// /demo/?world=/files/<world>/&area=4,2,4,2.
//   node cli/serve.mjs [--dir <dir>] [--port 8080] [--host 127.0.0.1]
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "./server.mjs";

const { values } = parseArgs({ options: { dir: { type: "string" }, port: { type: "string", default: "8080" }, host: { type: "string", default: "127.0.0.1" } } });
const { url } = await serve(values.dir ? { "/files/": path.resolve(values.dir) } : {}, { host: values.host, port: Number(values.port) });
console.log(`${url}/demo/`);
