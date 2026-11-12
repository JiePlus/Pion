import { test } from "@playwright/test";
import { taskFixture } from "../../tests/task-fixture";

// Captures the shell in both themes with seeded example data. Run with:
// npx playwright test --config design/liquid-glass/shots.config.ts
const seed = () => {
  localStorage.setItem("pion.locale", "zh-CN");
  localStorage.setItem(
    "fixture.catalog",
    JSON.stringify({
      projects: [
        { id: "p1", name: "Pion", path: "/projects/Pion" },
        { id: "p2", name: "pi-web", path: "/projects/pi-web" },
      ],
      tasks: [
        { id: "1", projectId: "p1", title: "重构设置页玻璃卡片" },
        { id: "2", projectId: "p1", title: "修复流式回复自动跟随", unread: true },
        { id: "3", projectId: "p1", title: "审查 Tauri 依赖升级" },
        { id: "4", projectId: "p2", title: "导出 HTML 样式对齐" },
      ],
    }),
  );
  localStorage.setItem(
    "fixture.histories",
    JSON.stringify({
      "1": [
        { role: "user", content: "把设置页改成 Bento 布局，保留现有的分组和快捷键说明。" },
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [
            { type: "thinking", thinking: "先检查现有设置页结构。" },
            { type: "text", text: "我先查看当前的设置页实现。" },
            {
              type: "toolCall",
              id: "r1",
              name: "read",
              arguments: { path: "src/ui/settings/Settings.module.css" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "r1",
          content: [{ type: "text", text: ".settings { max-width: 1040px; }" }],
          isError: false,
        },
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [
            {
              type: "text",
              text: "设置页现在是单列表单。我会改成 12 列网格：\n\n- Pi 版本和可用模型数做成大数字卡片\n- 接入方式与插件各占半宽\n- 快捷键放在底部整行\n\n```css\n:root {\n  --pion-glass-tint: rgb(255 255 255 / 34%);\n}\n```",
            },
          ],
        },
      ],
    }),
  );
};

for (const theme of ["light", "dark"]) {
  test(`shell ${theme}`, async ({ page }) => {
    await page.addInitScript(seed);
    await page.addInitScript((value) => localStorage.setItem("pion.theme", value), theme);
    await taskFixture(page);
    await page.goto("/");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `design/liquid-glass/screens/start-${theme}.png` });
    await page.getByRole("button", { name: "重构设置页玻璃卡片" }).click();
    await page.locator(".core-chat").waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `design/liquid-glass/screens/task-${theme}.png` });
    await page.locator(".usage-ring").click();
    await page.getByText("1,200 / 12,000").waitFor();
    await page.screenshot({ path: `design/liquid-glass/screens/usage-${theme}.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `design/liquid-glass/screens/settings-${theme}.png` });
    await page.locator("main.settings").evaluate((el) => el.scrollTo(0, 900));
    await page.screenshot({ path: `design/liquid-glass/screens/settings2-${theme}.png` });
    await page
      .getByRole("navigation", { name: "设置分类" })
      .getByRole("button", { name: "模型服务" })
      .click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `design/liquid-glass/screens/models-${theme}.png` });
    const sections = [
      ["扩展包", "packages"],
      ["技能", "skills"],
      ["桌面插件", "plugins"],
      ["快捷键", "shortcuts"],
    ];
    for (const [name, file] of sections) {
      await page
        .getByRole("navigation", { name: "设置分类" })
        .getByRole("button", { name, exact: true })
        .click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `design/liquid-glass/screens/${file}-${theme}.png` });
    }
  });
}
