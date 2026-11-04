import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { taskFixture } from "./task-fixture";

const manifest = JSON.parse(readFileSync("plugins/git-diff-plugin/plugin.json", "utf8"));
const source = readFileSync("plugins/git-diff-plugin/index.js", "utf8");
const record = { bundle: { manifest, source }, digest: "git-diff-fixture", enabled: true };

async function startTask(page: import("@playwright/test").Page) {
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Git diff task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Git diff task");
}

test("baseline task screen without the Git/Diff plugin", async ({ page }, testInfo) => {
  mkdirSync("artifacts/ui-qa", { recursive: true });
  await taskFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await startTask(page);
  await expect(page.locator('[data-panel="git-diff.panel"]')).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/ui-qa/${testInfo.project.name}-git-diff-before.png`,
    fullPage: true,
  });
});

test("Git/Diff plugin shows branch, changed files and a unified diff", async ({
  page,
}, testInfo) => {
  mkdirSync("artifacts/ui-qa", { recursive: true });
  await page.addInitScript((installed) => {
    localStorage.setItem("pion.locale", "en");
    localStorage.setItem("fixture.plugins", JSON.stringify([installed]));
  }, record);
  await taskFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await startTask(page);

  const panel = page.locator('[data-panel="git-diff.panel"]');
  await expect(panel).toContainText("main");
  await expect(panel).toContainText("3 changed files");
  await expect(panel.getByRole("button", { name: /runtime\.ts/ })).toBeVisible();

  await panel.getByRole("button", { name: /runtime\.ts/ }).click();
  await expect(panel.locator("pre")).toContainText('+  "workspace.gitStatus": "workspace.git"');
  await expect(panel).toContainText("Unstaged · 1");

  await page.screenshot({
    path: `artifacts/ui-qa/${testInfo.project.name}-git-diff-after.png`,
    fullPage: true,
  });
});
