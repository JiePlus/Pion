#!/usr/bin/env node
// Scaffold a new Desktop Plugin from templates/plugin.
// Usage: node scripts/create-plugin.mjs <target-dir> <plugin-id> ["Display Name"]
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [target, id, name = "My Plugin"] = process.argv.slice(2);
if (!target || !id) {
  console.error('Usage: node scripts/create-plugin.mjs <target-dir> <plugin-id> ["Display Name"]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{0,62}$/.test(id) || id === "core") {
  console.error("Plugin id must match ^[a-z][a-z0-9-]*$ and not be 'core'.");
  process.exit(1);
}
if (existsSync(target) && readdirSync(target).length) {
  console.error(`Target directory is not empty: ${target}`);
  process.exit(1);
}
const source = new URL("../templates/plugin/", import.meta.url);
cpSync(source, target, { recursive: true });
for (const file of readdirSync(target)) {
  const path = join(target, file);
  const text = readFileSync(path, "utf8");
  writeFileSync(
    path,
    text.replaceAll("__ID__", id).replaceAll("__NAME__", name.replaceAll('"', "'")),
  );
}
console.log(`Created plugin "${id}" at ${target}. Review it in Settings → Plugins.`);
