import { test, expect } from "@playwright/test";
import { taskFixture } from "./task-fixture";

test("history renders Markdown, thinking and tools in order and copies code safely", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.catalog",
      JSON.stringify({
        projects: [{ id: "p1", name: "Pion", path: "/projects/Pion" }],
        tasks: [{ id: "1", projectId: "p1", title: "完善聊天消息展示" }],
      }),
    );
    localStorage.setItem(
      "fixture.histories",
      JSON.stringify({
        "1": [
          { role: "user", content: "参考 **pi-web**，整理一下聊天消息的展示。" },
          {
            role: "assistant",
            provider: "openai",
            model: "gpt-test",
            content: [
              {
                type: "thinking",
                thinking: "先检查现有消息结构。\n\n保留工具调用与最终回复的顺序。",
              },
              { type: "text", text: "我先查看当前的消息渲染实现。" },
              {
                type: "toolCall",
                id: "read-1",
                name: "read",
                arguments: { path: "src/ui/CoreChat.tsx" },
              },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "read-1",
            content: [
              { type: "text", text: "export function CoreChat() {\n  return conversation;\n}" },
            ],
            isError: false,
          },
          {
            role: "assistant",
            provider: "anthropic",
            model: "claude-test",
            content: [
              {
                type: "text",
                text: '## 消息展示已整理\n\n现在支持 **Markdown**、`行内代码` 和工具执行详情。\n\n- 用户消息靠右显示\n- 思考过程可展开查看\n- 工具记录按发生顺序保留\n\n```ts\nconst message = "Hello, Pion";\nconsole.log(message);\n```\n\n| 消息类型 | 展示方式 |\n| --- | --- |\n| 用户 | 右侧气泡 |\n| 助手 | Markdown 正文 |\n\n> 向上翻阅时保留当前位置。\n\n[文档](https://example.com/docs)',
              },
            ],
          },
        ],
      }),
    );
  });
  await page.reload();
  await page.locator(".task-list").getByRole("button", { name: "完善聊天消息展示" }).click();
  await expect(page.getByRole("heading", { name: "消息展示已整理" })).toBeVisible();
  await expect(page.locator(".message-markdown table")).toBeVisible();
  await expect(page.locator(".chat-message.user strong")).toHaveText("pi-web");
  await expect(page.locator(".tool-call")).toHaveCount(1);
  await expect(page.locator(".tool-call summary")).toContainText("Completed");
  await expect(page.locator(".tool-details")).not.toBeVisible();
  await page.locator(".tool-call summary").click();
  await expect(page.locator(".tool-details")).toContainText("src/ui/CoreChat.tsx");
  await expect(page.locator(".tool-details")).toContainText("return conversation");
  await page.locator(".thinking-block summary").click();
  await expect(page.locator(".thinking-block .message-markdown")).toContainText("保留工具调用");
  await expect(page.locator(".chat-message").nth(1)).toContainText("read");
  await expect(page.locator(".chat-message").nth(2)).toContainText("消息展示已整理");
  await expect(page.locator(".message-actions > span")).toHaveText(["GPT Test", "Claude Test"]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          localStorage.setItem("fixture.clipboard", text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.locator(".code-toolbar").getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.locator(".code-toolbar")).toContainText("Copied");
  expect(await page.evaluate(() => localStorage.getItem("fixture.clipboard"))).toBe(
    'const message = "Hello, Pion";\nconsole.log(message);\n',
  );
  await page.locator(".thinking-block summary").click();
  await page.locator(".tool-call summary").click();
  await page.screenshot({ path: "test-results/conversation-markdown.png", fullPage: true });

  await page.evaluate(() => {
    (window as any).fixturePiEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content:
          '<script>window.pwned = true</script>\n\n[bad](javascript:alert(1))\n\n<img src=x onerror="alert(1)">',
      },
    });
  });
  await expect(
    page.locator(
      ".chat-message script, .chat-message img[onerror], .chat-message a[href^='javascript:']",
    ),
  ).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  await page.locator(".code-toolbar button").click();
  await expect(page.locator(".code-toolbar")).toContainText("Copy failed");
});

test("conversation detail modes summarize, collapse and fully reveal reasoning and tools", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.catalog",
      JSON.stringify({
        projects: [{ id: "p1", name: "Pion", path: "/projects/Pion" }],
        tasks: [{ id: "1", projectId: "p1", title: "Detail modes" }],
      }),
    );
    localStorage.setItem(
      "fixture.histories",
      JSON.stringify({
        "1": [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Inspect the current interaction model." },
              { type: "toolCall", id: "read-1", name: "read", arguments: { path: "src" } },
            ],
          },
          { role: "toolResult", toolCallId: "read-1", content: "result", isError: false },
          { role: "assistant", content: "Done." },
        ],
      }),
    );
  });
  await page.reload();
  await page.locator('.task-list button[title="Detail modes"]').click();

  const detail = {
    selectOption: async (label: "Summary" | "Normal" | "Verbose") => {
      await page.getByRole("button", { name: "Conversation detail" }).click();
      await page.getByRole("menuitemradio", { name: label }).click();
    },
  };
  await detail.selectOption("Summary");
  await expect(page.locator(".thinking-summary")).toBeVisible();
  await expect(page.locator(".thinking-block")).toHaveCount(0);
  await expect(page.locator(".tool-call-summary")).toBeVisible();
  await expect(page.locator(".tool-details")).toHaveCount(0);

  await detail.selectOption("Normal");
  await expect(page.locator(".thinking-block")).not.toHaveAttribute("open", "");
  await expect(page.locator(".tool-details")).not.toBeVisible();

  await detail.selectOption("Verbose");
  await expect(page.locator(".thinking-block")).toHaveAttribute("open", "");
  await expect(page.locator(".tool-call")).toHaveAttribute("open", "");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pion.viewMode")))
    .toBe("verbose");
});

test("sending locks immediately and ignores duplicate submissions", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Start chat");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Start chat");
  await page.evaluate(() => {
    localStorage.setItem("fixture.delaySend", "yes");
    localStorage.setItem("fixture.piRequestCount", "0");
  });

  const composer = page.getByRole("textbox", { name: /Ask Pi/ });
  await composer.fill("Only once");
  await composer.evaluate((element) => {
    const form = (element as HTMLTextAreaElement).form;
    form?.requestSubmit();
    form?.requestSubmit();
  });

  await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Reply for Only once", { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("fixture.piRequestCount"))).toBe("1");
});

test("stream snapshots retain thinking and tool results, settle once and respect scroll position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Streaming test");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Streaming test");
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({ type: "agent_start" });
    emit({ type: "message_start", message: { role: "assistant", content: [] } });
    emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Checking the streaming output" },
          { type: "text", text: "Partial **answer**" },
        ],
      },
    });
  });
  await expect(page.locator(".streaming .thinking-block summary")).toContainText(
    "Checking the streaming output",
  );
  await expect(page.locator(".streaming strong")).toHaveText("answer");
  await expect(page.locator(".chat-working")).toBeVisible();
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Checked the streaming output" },
          { type: "text", text: "Authoritative answer" },
          { type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "npm test" } },
        ],
      },
    });
    emit({ type: "tool_execution_start", toolCallId: "bash-1" });
    emit({
      type: "tool_execution_update",
      toolCallId: "bash-1",
      partialResult: { content: [{ type: "text", text: "Running test suite" }] },
    });
  });
  await expect(page.locator(".streaming")).toHaveCount(0);
  await expect(page.getByText("Authoritative answer", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Partial answer", { exact: true })).toHaveCount(0);
  await page.locator(".tool-call.running summary").click();
  await expect(page.locator(".tool-call.running pre").last()).toHaveText("Running test suite");
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({
      type: "tool_execution_end",
      toolCallId: "bash-1",
      isError: true,
      result: { content: [{ type: "text", text: "A test failed" }] },
    });
    // Synchronous event delivery exercises long conversations without asynchronous loops.
    Array.from({ length: 110 }, (_, index) =>
      emit({
        type: "message_end",
        message: { role: "assistant", content: `History message ${index}` },
      }),
    );
  });
  await expect(page.locator(".tool-call.failed summary")).toContainText("Failed");
  await expect(page.getByText("History message 109", { exact: true })).toBeInViewport();
  await expect(page.getByText("Reply for Streaming test", { exact: true })).toHaveCount(1);
  await page.locator(".chat-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.getByRole("button", { name: "Scroll to latest" })).toBeVisible();
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({ type: "message_start", message: { role: "assistant", content: [] } });
    emit({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "New streaming tail" }] },
    });
  });
  await expect(page.getByText("New streaming tail", { exact: true })).not.toBeInViewport();
  expect(await page.locator(".chat-scroll").evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Scroll to latest" }).click();
  await expect(page.getByText("New streaming tail", { exact: true })).toBeInViewport();
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({
      type: "message_end",
      message: { role: "assistant", content: "Final tail", stopReason: "length" },
    });
    emit({ type: "agent_settled" });
  });
  await expect(page.locator(".chat-working")).toHaveCount(0);
  await expect(page.getByText("Response reached the output limit.")).toBeInViewport();
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({ type: "agent_start" });
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "cancelled-1", name: "bash", arguments: { command: "sleep 10" } },
        ],
      },
    });
    emit({ type: "tool_execution_start", toolCallId: "cancelled-1" });
    emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } });
    emit({ type: "agent_settled" });
  });
  await expect(page.locator(".tool-call.interrupted")).toContainText("Interrupted");
  await expect(page.getByRole("alert")).toHaveText("Pi response failed.");
});
