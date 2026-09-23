import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const bridge = readFileSync(new URL("../src/core/sandbox-bridge.js", import.meta.url), "utf8");
export const bridgeHash = createHash("sha256").update(bridge).digest("base64");
const path = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = readFileSync(path, "utf8");
const updated = config.replace(
  /script-src 'self' 'sha256-[^']*' blob:/,
  `script-src 'self' 'sha256-${bridgeHash}' blob:`,
);
if (!updated.includes(`'sha256-${bridgeHash}'`))
  throw new Error("Missing plugin bridge CSP directive");
if (updated !== config) writeFileSync(path, updated);
