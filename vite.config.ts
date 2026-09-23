import { bridgeHash } from "./scripts/sync-csp.mjs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.PLUGIN_BRIDGE_HASH": JSON.stringify(bridgeHash) },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
