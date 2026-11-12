import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { taskFixture } from "../../tests/task-fixture";

// Component-level captures of the shipped composer and dialogs in both themes.
const shot = (page: Page, name: string, theme: string) =>
  page.screenshot({ path: `design/liquid-glass/screens/c-${name}-${theme}.png` });

for (const theme of ["light", "dark"]) {
  test(`components ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("pion.locale", "zh-CN");
      localStorage.setItem("pion.theme", value);
    }, theme);
    await taskFixture(page);
    await page.goto("/");
    await page.getByRole("textbox", { name: "描述你的任务" }).fill("组件检查");
    await page.getByRole("button", { name: "开始任务" }).click();
    await page.locator(".core-chat").waitFor();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByRole("menuitem", { name: "技能" }).hover();
    await page.waitForTimeout(250);
    await shot(page, "add-menu", theme);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.waitForTimeout(250);
    await shot(page, "model-pill", theme);
    await page.getByRole("menuitem", { name: "思考级别" }).hover();
    await page.waitForTimeout(300);
    await shot(page, "model-thinking", theme);
    await page.getByRole("menuitem", { name: "更多模型" }).hover();
    await page.waitForTimeout(300);
    await shot(page, "model-more", theme);
    await page.keyboard.press("Escape");

    await page.locator(".usage-ring").click();
    await page.waitForTimeout(400);
    await shot(page, "context", theme);
    await page.keyboard.press("Escape");

    await page.evaluate(() => localStorage.setItem("fixture.hold", "yes"));
    await page.getByRole("textbox", { name: /让 Pi/ }).fill("继续检查");
    await page.getByRole("textbox", { name: /让 Pi/ }).press("Enter");
    await page.getByRole("button", { name: "停止任务" }).waitFor();
    await page.waitForTimeout(300);
    await shot(page, "running", theme);
    await page.getByRole("textbox", { name: /让 Pi/ }).fill("再跑一遍测试");
    await page.waitForTimeout(200);
    await shot(page, "running-draft", theme);
    await page.getByRole("textbox", { name: /让 Pi/ }).fill("");
    await page.getByRole("button", { name: "停止任务" }).click();
    await page.evaluate(() => localStorage.removeItem("fixture.hold"));

    await page.getByRole("button", { name: "对话详细程度" }).click();
    await page.waitForTimeout(250);
    await shot(page, "view-mode", theme);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "任务操作" }).click();
    await page.waitForTimeout(200);
    await shot(page, "task-menu", theme);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.waitForTimeout(300);
    await page.locator("main.settings").evaluate((el) => el.scrollTo(0, 560));
    await page.waitForTimeout(200);
    await shot(page, "task-defaults", theme);
    await page.locator("main.settings").evaluate((el) => el.scrollTo(0, 300));
    await page.getByRole("combobox", { name: "界面语言" }).click();
    await page.waitForTimeout(250);
    await shot(page, "language-select", theme);
    await page.keyboard.press("Escape");
  });
}

for (const theme of ["light", "dark"]) {
  test(`transcript states ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("pion.locale", "zh-CN");
      localStorage.setItem("pion.theme", value);
      localStorage.setItem(
        "fixture.catalog",
        JSON.stringify({
          projects: [{ id: "p1", name: "Pion", path: "/projects/Pion" }],
          tasks: [{ id: "1", projectId: "p1", title: "你是谁" }],
        }),
      );
      localStorage.setItem(
        "fixture.histories",
        JSON.stringify({
          "1": [
            { role: "user", content: "你好" },
            {
              role: "assistant",
              content: [],
              stopReason: "aborted",
              errorMessage: "Request was aborted",
            },
            { role: "user", content: "你试试" },
            { role: "assistant", content: [], stopReason: "error", errorMessage: "fetch failed" },
          ],
        }),
      );
    }, theme);
    await taskFixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: "你是谁" }).click();
    await page.locator(".core-chat").waitFor();
    await page.evaluate(() => {
      localStorage.setItem("fixture.hold", "yes");
      (window as any).fixturePiEvent({ type: "agent_start" });
    });
    await page.waitForTimeout(2600);
    await shot(page, "working", theme);
    await page.evaluate(() => {
      const emit = (window as any).fixturePiEvent;
      emit({
        type: "message_update",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "run-1", name: "bash", arguments: { command: "npm test" } },
          ],
        },
      });
      emit({ type: "tool_execution_start", toolCallId: "run-1", toolName: "bash" });
    });
    await page.waitForTimeout(400);
    await shot(page, "working-tool", theme);
    await page.evaluate(() =>
      (window as any).fixturePiEvent({
        type: "auto_retry_start",
        attempt: 3,
        maxAttempts: 3,
        delayMs: 8000,
        errorMessage: "fetch failed",
      }),
    );
    await page.waitForTimeout(1500);
    await shot(page, "retry", theme);
  });
}
