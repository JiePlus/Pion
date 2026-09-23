import { expect, test } from "@playwright/test";
import { taskFixture } from "./task-fixture";

async function menuButton(page: import("@playwright/test").Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible())) await page.getByRole("button", { name: "More options" }).click();
  await button.click();
}

async function menuSelect(page: import("@playwright/test").Page, name: string, value: string) {
  const select = page.getByRole("combobox", { name });
  if (!(await select.isVisible())) await page.getByRole("button", { name: "More options" }).click();
  await select.selectOption(value);
}

async function start(page: import("@playwright/test").Page, title = "Pi features") {
  await page.getByRole("textbox", { name: "Describe your task" }).fill(title);
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toBeVisible();
}

async function openTaskActions(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Task actions" }).click();
}

test("extension confirm, select, input and editor dialogs correlate responses and time out", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await start(page);
  const emit = (request: object) =>
    page.evaluate((value) => (window as any).fixturePiEvent(value), request);

  await emit({
    type: "extension_ui_request",
    id: "confirm-1",
    method: "confirm",
    title: "Allow command?",
    message: "Run the requested tool?",
  });
  await page.getByRole("button", { name: "Yes" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"confirmed":true');

  await emit({
    type: "extension_ui_request",
    id: "select-1",
    method: "select",
    title: "Choose target",
    options: ["Alpha", "Beta"],
  });
  await page.getByRole("option", { name: "Beta" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"value":"Beta"');

  await emit({
    type: "extension_ui_request",
    id: "input-1",
    method: "input",
    title: "Enter name",
    placeholder: "name",
  });
  await page.getByRole("textbox", { name: "Enter name" }).fill("Pion");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"value":"Pion"');

  await emit({
    type: "extension_ui_request",
    id: "editor-1",
    method: "editor",
    title: "Edit text",
    prefill: "Line one",
  });
  await expect(page.getByRole("textbox", { name: "Edit text" })).toHaveValue("Line one");
  await page.getByRole("textbox", { name: "Edit text" }).fill("Line one\nLine two");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain("Line two");

  await emit({
    type: "extension_ui_request",
    id: "timeout-1",
    method: "confirm",
    title: "Timed prompt",
    message: "Wait",
    timeout: 30,
  });
  await expect(page.getByRole("heading", { name: "Timed prompt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timed prompt" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"id":"editor-1"');

  await emit({
    type: "extension_ui_request",
    id: "escape-1",
    method: "input",
    title: "Cancel with Escape",
  });
  await expect(page.getByRole("textbox", { name: "Cancel with Escape" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Submit" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Cancel with Escape" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"id":"escape-1"');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionResponse")))
    .toContain('"cancelled":true');

  await page.evaluate(() => localStorage.setItem("fixture.delayExtensionResponse", "yes"));
  await emit({
    type: "extension_ui_request",
    id: "loading-1",
    method: "confirm",
    title: "Loading response",
    message: "Wait for Pi",
  });
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("dialog", { name: "Loading response" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Loading response" })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("fixture.delayExtensionResponse"));

  await emit({
    type: "extension_ui_request",
    id: "status-1",
    method: "setStatus",
    statusKey: "demo",
    statusText: "Extension ready",
  });
  await emit({
    type: "extension_ui_request",
    id: "widget-1",
    method: "setWidget",
    widgetKey: "demo",
    widgetLines: ["Widget line"],
    widgetPlacement: "aboveEditor",
  });
  await emit({
    type: "extension_ui_request",
    id: "title-1",
    method: "setTitle",
    title: "Extension title",
  });
  await emit({
    type: "extension_ui_request",
    id: "draft-1",
    method: "set_editor_text",
    text: "Extension draft",
  });
  await emit({
    type: "extension_ui_request",
    id: "notify-1",
    method: "notify",
    message: "Extension notification",
    notifyType: "warning",
  });
  await expect(page.getByText("Extension ready")).toBeVisible();
  await expect(page.getByText("Widget line")).toBeVisible();
  await expect(page.locator(".topbar")).toContainText("Extension title");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("Extension draft");
  await expect(page.getByText("Extension notification")).toBeVisible();

  await emit({
    type: "extension_ui_request",
    id: "switch-1",
    method: "input",
    title: "Cleared on switch",
  });
  await expect(page.getByRole("heading", { name: "Cleared on switch" })).toBeVisible();
  await page
    .locator(".rail nav button")
    .first()
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("heading", { name: "Cleared on switch" })).toHaveCount(0);
  await expect(page.locator(".topbar")).not.toContainText("Extension title");
});

test("images preview, remove, send, survive failure and warn for unsupported models", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await start(page, "Images");
  const image = {
    id: "picked-1",
    name: "pixel.png",
    mimeType: "image/png",
    size: 12,
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  };
  await page.evaluate(
    (value) => localStorage.setItem("fixture.pickedImages", JSON.stringify([value])),
    image,
  );
  await menuButton(page, "Attach images");
  await expect(page.locator(".attachment-strip img")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove pixel.png" }).click();
  await expect(page.locator(".attachment-strip img")).toHaveCount(0);
  await menuButton(page, "Attach images");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Describe it");
  await page.getByRole("button", { name: "Send to Pi" }).click();
  await expect(page.locator(".attachment-strip img")).toHaveCount(0);
  await expect(page.locator(".chat-message.user .message-image")).toHaveCount(1);

  await page.evaluate(() => {
    localStorage.setItem("fixture.hold", "yes");
    (window as any).fixturePiEvent({ type: "agent_start" });
  });
  await menuButton(page, "Attach images");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Steer with image");
  await page.getByRole("button", { name: "Steer" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.lastPiRequest") ?? "{}")),
    )
    .toMatchObject({ command: "steer", args: { message: "Steer with image" } });
  await expect(page.locator(".attachment-strip img")).toHaveCount(0);
  await menuButton(page, "Attach images");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Follow with image");
  await menuButton(page, "Queue next");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.lastPiRequest") ?? "{}")),
    )
    .toMatchObject({ command: "follow_up", args: { message: "Follow with image" } });
  await page.getByRole("button", { name: "Stop agent" }).click();
  await page.evaluate(() => localStorage.removeItem("fixture.hold"));

  await page.evaluate(() => localStorage.setItem("fixture.failSend", "yes"));
  await menuButton(page, "Attach images");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Keep this");
  await page.getByRole("button", { name: "Send to Pi" }).click();
  await expect(page.locator(".attachment-strip img")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("Keep this");

  await page.evaluate(() => {
    localStorage.removeItem("fixture.failSend");
    localStorage.setItem("fixture.noImages", "yes");
  });
  await page.locator(".new-task-button").click();
  await page.getByRole("textbox", { name: "Describe your task" }).fill("No images");
  await page.getByRole("button", { name: "Start task" }).click();
  await menuButton(page, "Attach images");
  await expect(page.getByText("The current model does not support image input.")).toBeVisible();
});

test("new task sends its first image and keeps it when the prompt fails", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  const image = {
    id: "initial-image",
    name: "pixel.png",
    mimeType: "image/png",
    size: 12,
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  };
  await page.evaluate(
    (value) => localStorage.setItem("fixture.pickedImages", JSON.stringify([value])),
    image,
  );
  await page.getByRole("button", { name: "Attach images" }).click();
  await expect(page.locator(".command-form .attachment-strip img")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove pixel.png" }).click();
  await expect(page.locator(".command-form .attachment-strip img")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Describe your task" }).evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  });
  await expect(page.locator(".command-form .attachment-strip img")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove pasted.png" }).click();
  await page.locator(".command-form").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "dropped.png", { type: "image/png" }));
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await expect(page.locator(".command-form .attachment-strip img")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove dropped.png" }).click();
  await page.getByRole("button", { name: "Attach images" }).click();
  await page.evaluate(() => localStorage.setItem("fixture.failSend", "yes"));
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Prompt rejected for test");
  await expect(page.locator(".core-composer .attachment-strip img")).toHaveCount(1);
  await page.evaluate(() => localStorage.removeItem("fixture.failSend"));
  await page.getByRole("button", { name: "Send to Pi" }).click();
  await expect(page.locator(".chat-message.user .message-image")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.lastPiRequest") ?? "{}")),
    )
    .toMatchObject({ command: "prompt", args: { message: "", images: [image] } });

  await page.locator(".new-task-button").click();
  await page.getByRole("button", { name: "Attach images" }).click();
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Describe this image");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".chat-message.user .message-image")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.lastPiRequest") ?? "{}")),
    )
    .toMatchObject({
      command: "prompt",
      args: { message: "Describe this image", images: [image] },
    });
});

test("new task warns when the selected model cannot read images", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.models",
      JSON.stringify([{ provider: "openai", id: "gpt-test", name: "GPT Test", input: ["text"] }]),
    );
    localStorage.setItem(
      "fixture.pickedImages",
      JSON.stringify([
        {
          id: "initial-image",
          name: "pixel.png",
          mimeType: "image/png",
          size: 12,
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        },
      ]),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Attach images" }).click();
  await expect(page.getByText("The current model does not support image input.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
});

test("queue controls, fork, clone and rename keep task navigation mapped", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await start(page, "Branch source");
  await page.evaluate(() => {
    localStorage.setItem("fixture.hold", "yes");
    (window as any).fixturePiEvent({ type: "agent_start" });
  });
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("Queued work");
  await menuButton(page, "Queue next");
  await expect(page.getByRole("region", { name: "Queued messages" })).toContainText("Queued work");
  await page.getByRole("button", { name: "Move queue to editor" }).click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("Queued work");
  await page.getByRole("button", { name: "Stop agent" }).click();

  await menuSelect(page, "Steering mode", "all");
  await menuSelect(page, "Follow-up mode", "all");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.steeringMode")))
    .toBe("all");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.followUpMode")))
    .toBe("all");
  await page.evaluate(() => {
    const emit = (window as any).fixturePiEvent;
    emit({
      type: "compaction_end",
      result: {
        summary: "Kept the important context",
        tokensBefore: 9000,
        estimatedTokensAfter: 3000,
      },
    });
    emit({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "Overloaded",
    });
  });
  await expect(page.getByText("Compaction summary")).toBeVisible();
  await expect(page.locator(".compaction-card")).toContainText("Kept the important context");
  await expect(page.locator(".retry-card")).toContainText("Retry 1/3 in 2s");
  await page.getByRole("button", { name: "Cancel retry" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.retryAborted")))
    .toBe("yes");

  await openTaskActions(page);
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Session history" })).toBeVisible();
  await page.getByRole("button", { name: "Branch source", exact: true }).last().click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue(
    "Edited historical prompt",
  );
  await openTaskActions(page);
  await page.getByRole("menuitem", { name: "Clone", exact: true }).click();
  await expect(page.locator(".topbar")).toContainText("Clone:");
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_start" }));
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible();
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_settled" }));
  await openTaskActions(page);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Task name" }).fill("Renamed branch");
  await page.getByRole("button", { name: "Rename", exact: true }).last().click();
  await expect(page.locator(".topbar")).toContainText("Renamed branch");
});

test("extension commands execute immediately while the agent is running", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await start(page, "Extension command");
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_start" }));
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("/demo");
  await expect(page.getByRole("option", { name: /\/demo/ })).toBeVisible();
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.extensionCommand")))
    .toBe("prompt");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("");
});

test("tool presets use the core allowlist and reflect Pi extension status", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await start(page, "Tool presets");
  await page.getByRole("button", { name: "More options" }).click();
  const preset = page.getByRole("combobox", { name: "Tool preset" });
  await expect(preset).toHaveValue("full");
  await preset.selectOption("chat");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.toolPreset")))
    .toBe("chat");
  await expect(preset).toHaveValue("chat");
  await preset.selectOption("read-only");
  await expect(preset).toHaveValue("read-only");
});

test("safe RPC settings and legacy Pi sessions remain task-scoped", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Scan Pi sessions" }).click();
  await page.getByRole("checkbox", { name: /Imported CLI task/ }).check();
  await page.getByRole("button", { name: "Import selected sessions" }).click();
  await expect(
    page.locator(".task-list").getByRole("button", { name: "Imported CLI task" }),
  ).toBeVisible();
  await page.locator(".task-list").getByRole("button", { name: "Imported CLI task" }).click();
  await menuSelect(page, "Automatic compaction", "off");
  await menuSelect(page, "Automatic retry", "on");
  await menuButton(page, "Custom compaction");
  await page
    .getByRole("textbox", { name: "Compaction instructions" })
    .fill("Focus on code changes");
  await page.getByRole("button", { name: "Compact with instructions" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.compactRequest")))
    .toContain('"customInstructions":"Focus on code changes"');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.autoCompaction")))
    .toBe("false");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.autoRetry")))
    .toBe("true");
});
