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
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Pi models" }).click();
  await page.getByRole("button", { name: /OpenAI Add API key/ }).click();
  await expect(page.getByPlaceholder("openai")).toHaveValue("openai");

  await page.keyboard.press("Control+n");
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveValue(
    "Explore the project architecture",
  );
});

test.describe("Chinese desktop layout", () => {
  test.use({ locale: "zh-CN" });

  test("project and composer labels fit in both themes", async ({ page }) => {
    mkdirSync("artifacts/ui-qa", { recursive: true });
    await taskFixture(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "开始任务" })).toBeVisible();
    await page.screenshot({ path: "artifacts/ui-qa/chinese-workspace-light.png" });

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "深色终端" }).click();
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page.screenshot({ path: "artifacts/ui-qa/chinese-workspace-dark.png" });
  });
});
