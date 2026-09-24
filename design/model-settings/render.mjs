import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const output = join(directory, "screens");
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const url = pathToFileURL(join(directory, "index.html")).href;

async function capture(screen, theme) {
  await page.goto(`${url}?screen=${screen}&theme=${theme}`);
  await page.screenshot({ path: join(output, `${screen}-${theme}.png`) });
}

await capture("01-api-key", "light");
await capture("02-pi-login", "light");
await capture("03-login-flow", "light");
await capture("04-environment", "light");
await capture("05-custom-endpoint", "light");
await capture("06-add-provider", "light");
await capture("07-model-discovery", "light");
await capture("08-model-details", "light");
await capture("09-custom-empty", "light");
await capture("10-provider-extension", "light");
await capture("01-api-key", "dark");
await capture("02-pi-login", "dark");
await capture("03-login-flow", "dark");
await capture("04-environment", "dark");
await capture("05-custom-endpoint", "dark");
await capture("06-add-provider", "dark");
await capture("07-model-discovery", "dark");
await capture("08-model-details", "dark");
await capture("09-custom-empty", "dark");
await capture("10-provider-extension", "dark");

await browser.close();
