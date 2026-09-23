import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "gen",
  "icons",
  "test-results",
  "playwright-report",
]);
let count = 0;
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    if (
      !/\.(ts|tsx|js|mjs|json|rs|toml|css|html|md|svg)$/.test(path) &&
      entry.name !== ".editorconfig"
    )
      continue;
    const bytes = readFileSync(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
      text.includes("\r") ||
      !text.endsWith("\n") ||
      /[\t ]+$/m.test(text)
    )
      throw new Error(`Format violation: ${path}`);
    count++;
  }
}
visit(".");
console.log(`${count} text files: UTF-8 without BOM, LF, final newline, no trailing whitespace.`);
