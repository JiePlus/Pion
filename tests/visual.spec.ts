import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { taskFixture } from "./task-fixture";

test("desktop layouts remain composed across themes and compact sizes", async ({
  page,
}, testInfo) => {
  mkdirSync("artifacts/ui-qa", { recursive: true });
  const prefix = `artifacts/ui-qa/${testInfo.project.name}`;
  await taskFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({ path: `${prefix}-new-task-light.png` });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: `${prefix}-settings-light.png` });
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page.getByRole("textbox", { name: "Describe your task" }).fill("Visual task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat:visible")).toContainText("Reply for Visual task");
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.screenshot({ path: `${prefix}-session-light.png` });

  await page.evaluate(() => localStorage.setItem("fixture.hold", "yes"));
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Keep working");
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Enter");
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible();
  await page.screenshot({ path: `${prefix}-running-light.png` });
  await page.getByRole("button", { name: "Stop agent" }).click();
  await page.evaluate(() => localStorage.removeItem("fixture.hold"));

  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: `${prefix}-compact-light.png` });
  await page.evaluate(() => localStorage.setItem("pion.theme", "dark"));
  await page.reload();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${prefix}-new-task-dark.png` });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: `${prefix}-settings-dark.png` });
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.locator('.task-list button[title="Visual task"]').click();
  await expect(page.locator(".core-chat:visible")).toContainText("Reply for Visual task");

  await page.setViewportSize({ width: 1280, height: 840 });
  await page.screenshot({ path: `${prefix}-session-dark.png` });
  await page.evaluate(() => localStorage.setItem("fixture.hold", "yes"));
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Continue in dark mode");
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Enter");
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible();
  await page.screenshot({ path: `${prefix}-running-dark.png` });

  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: `${prefix}-compact-dark.png` });
});
