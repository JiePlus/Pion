import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { taskFixture } from "./task-fixture";

test("design copy is shown in Chinese on first launch", async ({ page }) => {
  mkdirSync("artifacts/ui-qa", { recursive: true });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("button", { name: "模型", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天想做什么？" })).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-qa/chinese-new-task.png" });

  await page.getByRole("button", { name: "模型", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模型服务" })).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-qa/chinese-models.png" });

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: "artifacts/ui-qa/chinese-settings.png" });
  await page.getByRole("button", { name: "快捷键", exact: true }).click();
  await expect(page.getByRole("heading", { name: "快捷键" })).toBeVisible();
  await page.getByRole("button", { name: "桌面插件", exact: true }).click();
  await page.getByRole("button", { name: "管理扩展面板" }).click();
  await expect(page.getByRole("heading", { name: "扩展面板" })).toBeVisible();
});

test("redesigned shortcuts and controls perform their actions", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Explore the project architecture" }).click();
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveValue(
    "Explore the project architecture",
  );
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toBeFocused();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark", exact: true }).press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Pi models" }).click();
  await page.getByRole("button", { name: "Configure OpenAI" }).click();
  await expect(page.getByLabel("OpenAI API Key")).toBeVisible();

  await page.keyboard.press("Control+n");
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveValue(
    "Explore the project architecture",
  );
});

for (const theme of ["light", "dark"]) {
  test(`short new-task viewport keeps sending reachable in ${theme} mode`, async ({ page }) => {
    await taskFixture(page);
    await page.addInitScript((value) => localStorage.setItem("pion.theme", value), theme);
    await page.setViewportSize({ width: 720, height: 500 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "Describe your task" }).fill("Inspect the project");
    const send = page.getByRole("button", { name: "Start task", exact: true });
    await expect(send).toBeInViewport({ ratio: 1 });
    const sendBounds = await send.boundingBox();
    const statusBounds = await page.locator(".statusbar").boundingBox();
    expect(sendBounds).not.toBeNull();
    expect(statusBounds).not.toBeNull();
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(statusBounds!.y);
    await send.click();
    await expect(
      page
        .getByRole("region", { name: "Pi conversation" })
        .getByText("Inspect the project", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Appearance and display", exact: true }),
    ).toBeVisible();
  });
}

test.describe("Chinese desktop layout", () => {
  test.use({ locale: "zh-CN" });

  test("project and composer labels fit in both themes", async ({ page }) => {
    mkdirSync("artifacts/ui-qa", { recursive: true });
    await taskFixture(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "开始任务" })).toBeVisible();
    await page.screenshot({ path: "artifacts/ui-qa/chinese-workspace-light.png" });

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("radio", { name: "深色终端", exact: true }).press("Space");
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page.screenshot({ path: "artifacts/ui-qa/chinese-workspace-dark.png" });
  });
});
