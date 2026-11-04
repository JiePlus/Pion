import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { taskFixture } from "./task-fixture";
import { createHash } from "node:crypto";

const builtin = JSON.parse(readFileSync("plugins/agent-chat/plugin.json", "utf8"));
const bridgeHash = createHash("sha256")
  .update(readFileSync("src/core/sandbox-bridge.js"))
  .digest("base64");
const hello = JSON.parse(readFileSync("examples/hello-plugin/plugin.json", "utf8"));
const helloSource = readFileSync("examples/hello-plugin/index.js", "utf8");
const installed = (manifest: unknown, source: string) => ({
  bundle: { manifest, source },
  enabled: true,
  digest: "test",
});

async function openTaskActions(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Task actions" }).click();
}

test("browser preview does not offer native Pi installation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pion.locale", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check Pi updates" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Install Pi globally" })).toHaveCount(0);
});

test("completed setup stays out of regular settings", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up Pi" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pi setup" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pi version" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up Pi" })).toHaveCount(0);
});

test("new task waits for Pi detection without showing a false setup warning", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("fixture.delaySetupStatus", "yes");
    localStorage.removeItem("fixture.setupStatusFinished");
    localStorage.removeItem("fixture.prepareStarted");
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Checking Pi…" })).toBeVisible();
  await expect(page.getByText("Finish Pi setup before starting a task.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.prepareStarted")))
    .toBe("yes");
  await expect(page.getByText("Checking Pi…")).toHaveCount(0);
  await expect(page.getByText("Finish Pi setup before starting a task.")).toHaveCount(0);
});

test("initial setup installs missing Pi and continues after model authentication", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "fixture.setupStatus",
      JSON.stringify({
        installation: "missing",
        verifiedVersion: "0.87.1",
        canInstall: true,
        modelReady: false,
        selectedModel: { provider: "openai", id: "gpt-test" },
        models: [{ provider: "openai", id: "gpt-test", name: "GPT Test" }],
      }),
    ),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set up Pi" })).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".statusbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Install Pi globally" }).click();
  await expect(page.getByRole("heading", { name: "Choose a model" })).toBeVisible();
  await page.getByPlaceholder("openai").fill("openai");
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByRole("button", { name: "Save API key" }).click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(page.locator(".rail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
});

test("setup shows a broken path and keeps task creation gated", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "fixture.setupStatus",
      JSON.stringify({
        installation: "broken",
        executable: "/missing/pi",
        verifiedVersion: "0.87.1",
        canInstall: false,
        detail: "Cannot start Pi",
      }),
    ),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set up Pi" })).toBeVisible();
  await expect(page.getByText("Cannot start Pi")).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveCount(0);
});

test("settings checks a verified Pi update before enabling one-click update", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.setupStatus",
      JSON.stringify({
        installation: "ready",
        executable: "pi",
        installedVersion: "0.87.0",
        verifiedVersion: "0.87.1",
        npmManaged: true,
        canInstall: true,
        modelReady: true,
        selectedModel: { provider: "openai", id: "gpt-test" },
        models: [{ provider: "openai", id: "gpt-test", name: "GPT Test" }],
      }),
    );
    localStorage.setItem(
      "fixture.versionStatus",
      JSON.stringify({
        installation: "ready",
        installedVersion: "0.87.0",
        verifiedVersion: "0.87.1",
        latestVersion: "0.87.1",
        npmManaged: true,
        canUpdate: true,
      }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Check Pi updates" }).click();
  await expect(page.getByRole("button", { name: "Update Pi to 0.87.1" })).toBeVisible();
  await page.getByRole("button", { name: "Update Pi to 0.87.1" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.piUpdated")))
    .toBe("yes");
});

test("setup waits when the chosen model has no usable authentication", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "fixture.setupStatus",
      JSON.stringify({
        installation: "ready",
        executable: "pi",
        installedVersion: "0.87.1",
        verifiedVersion: "0.87.1",
        npmManaged: true,
        canInstall: true,
        modelReady: false,
        selectedModel: { provider: "openai", id: "gpt-test" },
        models: [{ provider: "openai", id: "gpt-test", name: "GPT Test" }],
      }),
    ),
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Pi executable" })).toHaveCount(0);
  await page.getByRole("button", { name: "Change Pi path" }).click();
  await expect(page.getByRole("textbox", { name: "Pi executable" })).toBeVisible();
  await page.getByRole("button", { name: "Check model again" }).click();
  await expect(page.getByRole("heading", { name: "Set up Pi" })).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveCount(0);
});

test("setup motion respects reduced motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "fixture.setupStatus",
      JSON.stringify({ installation: "missing", verifiedVersion: "0.87.1", canInstall: true }),
    ),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Install Pi globally" })).toBeVisible();
  expect(
    await page
      .locator(".pi-setup-content")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
});

test("update failures leave tasks available", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("fixture.failUpdateCheck", "yes");
    localStorage.setItem("fixture.updateBlocked", "yes");
    localStorage.setItem(
      "fixture.versionStatus",
      JSON.stringify({
        installation: "ready",
        installedVersion: "0.87.0",
        verifiedVersion: "0.87.1",
        latestVersion: "0.87.1",
        npmManaged: true,
        canUpdate: true,
      }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Check Pi updates" }).click();
  await expect(page.getByRole("alert")).toContainText("Pi update check is offline");
  await expect(page.getByRole("button", { name: "Update Pi to 0.87.1" })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("fixture.failUpdateCheck"));
  await page.getByRole("button", { name: "Check Pi updates" }).click();
  await page.getByRole("button", { name: "Update Pi to 0.87.1" }).click();
  await expect(page.getByRole("alert")).toContainText("Wait for running Pi tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toBeEnabled();
});

test("new task prepares chat, resumes isolated history, keeps drafts and switches across running tasks", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Model", exact: true })).toContainText("GPT Test");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("button", { name: "Claude Test · anthropic" }).click();
  await page.getByRole("combobox", { name: "Thinking" }).selectOption("high");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("First task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for First task");
  await expect(page.locator(".core-chat")).toContainText("read");
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("button", { name: "Model", exact: true })).toContainText(
    "Claude Test",
  );
  await expect(page.getByRole("combobox", { name: "Thinking" })).toHaveValue("high");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("");
  await page.getByRole("button", { name: "Pi command" }).click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("/");
  await expect(page.getByRole("option", { name: /fix-tests/ })).toBeVisible();
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("/fi");
  await page.getByRole("option", { name: /fix-tests/ }).click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("/fix-tests ");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("First task draft");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Second task");
  await page.getByRole("textbox", { name: "Describe your task" }).press("Enter");
  await expect(page.locator(".core-chat")).toContainText("Reply for Second task");
  await expect(page.locator(".core-chat")).not.toContainText("First task");
  await page.locator(".task-list").getByRole("button", { name: "First task", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("First task draft");
  await expect(page.locator(".core-chat")).toContainText("Reply for First task");
  await page.evaluate(() => localStorage.setItem("fixture.hold", "yes"));
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Shift+Enter");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("\nFirst task draft");
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Enter");
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("button", { name: "Queue next", exact: true })).toBeVisible();
  await page
    .locator(".task-list")
    .getByRole("button", { name: "Second task", exact: true })
    .click();
  await expect(page.locator(".topbar")).toContainText("Second task");
  await page.evaluate(() =>
    (window as any).fixturePiEventFor("1", {
      type: "message_end",
      message: { role: "assistant", content: "Background-only event" },
    }),
  );
  await expect(page.locator(".core-chat")).not.toContainText("Background-only event");
  const runningState = page.locator('.task-list button[title="First task"] .task-state');
  await expect(runningState).toBeVisible();
  expect(await runningState.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    "task-activity",
  );
  await page.locator('.task-list button[title="First task"]').click();
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
  await page.evaluate(() => localStorage.removeItem("fixture.hold"));
  await page.reload();
  await page
    .locator(".task-list")
    .getByRole("button", { name: "Second task", exact: true })
    .click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Second task");
  await page.screenshot({ path: "test-results/task-conversation.png", fullPage: true });
});

test("connection and send failures preserve input and a task can be reopened", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("fixture.failOpen", "yes"));
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Retry this task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByText(/Cannot start Pi: test failure/)).toBeVisible();
  await page.locator('.task-list button[title="Retry this task"]').click();
  await expect(page.getByText(/Cannot start Pi: test failure/)).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toHaveValue(
    "Retry this task",
  );
  await page.evaluate(() => {
    localStorage.removeItem("fixture.failOpen");
    localStorage.setItem("fixture.failSend", "yes");
  });
  await page.locator(".task-list").getByRole("button", { name: "Retry this task" }).click();
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("Retry this task");
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Enter");
  await expect(page.locator(".core-chat")).toContainText("Prompt rejected for test");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue("Retry this task");
});

test("cached task content appears before its serial Pi refresh completes", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Cached first");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Cached first");
  await page.evaluate(() =>
    (window as any).fixturePiEvent({
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: "cached-extension",
      statusText: "Extension cached",
    }),
  );
  await expect(page.locator(".extension-statuses")).toContainText("Extension cached");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Cached second");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Cached second");
  await page.evaluate(() => localStorage.setItem("fixture.refreshDelay", "yes"));
  await page.locator('.task-list button[title="Cached first"]').click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Cached first", {
    timeout: 100,
  });
  await expect(page.locator(".extension-statuses")).toContainText("Extension cached", {
    timeout: 100,
  });
  await page.evaluate(() => localStorage.removeItem("fixture.refreshDelay"));
  await page.locator('.task-list button[title="Cached second"]').click();
  await page.evaluate(() => localStorage.setItem("fixture.failRefresh", "yes"));
  await page.locator('.task-list button[title="Cached first"]').click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Cached first");
  await expect(
    page.getByText("Showing cached messages. Synchronization failed.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("fixture.failRefresh"));
  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.getByRole("button", { name: "Retry sync" })).toHaveCount(0);
});

test("extension commands wait for real agent events and deep history stays usable", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Deep history");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Deep history");
  await page.getByRole("textbox", { name: /Ask Pi/ }).fill("/info");
  await page.getByRole("textbox", { name: /Ask Pi/ }).press("Enter");
  await expect(page.getByRole("button", { name: "Stop agent" })).toHaveCount(0);
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_start" }));
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible();
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_settled" }));
  await page.evaluate(() => localStorage.setItem("fixture.historyDepth", "200"));
  await openTaskActions(page);
  await page.getByRole("menuitem", { name: "History", exact: true }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(200);
  await expect(page.getByRole("treeitem").last()).toContainText("Entry 199");
  await page.getByRole("button", { name: "Deep history", exact: true }).last().click();
  await expect(page.locator(".topbar")).toContainText("Fork:");
  await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toBeVisible();
});

test("background completion shows an unread marker after reload until opening", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Unread first");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Unread first");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Unread second");
  await page.getByRole("button", { name: "Start task" }).click();
  await page.evaluate(() => (window as any).fixtureTaskStatus("1", "idle"));
  await expect(page.locator('.task-list button[title="Unread first"] .unread-mark')).toBeVisible();
  await page.reload();
  await expect(page.locator('.task-list button[title="Unread first"] .unread-mark')).toBeVisible();
  await page.locator('.task-list button[title="Unread first"]').click();
  await expect(page.locator('.task-list button[title="Unread first"] .unread-mark')).toHaveCount(0);
  await expect(page.locator('.task-list button[title="Unread first"] .task-state')).toHaveCount(0);
  await page.getByRole("button", { name: "Search tasks" }).click();
  await expect(
    page.locator(".task-filters").getByRole("button", { name: "Attention", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).fixtureTaskStatus("1", "disconnected"));
  await expect(
    page.locator(".task-filters").getByRole("button", { name: "Attention", exact: true }),
  ).toBeVisible();
  await expect(page.locator('.task-list button[title="Unread first"] .task-state')).toHaveCount(0);
});

test("background task banner only counts tasks in the current project", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.catalog",
      JSON.stringify({
        projects: [
          { id: "p1", name: "Pion", path: "/projects/Pion" },
          { id: "p2", name: "Other", path: "/projects/Other" },
        ],
        tasks: [
          { id: "1", projectId: "p1", title: "Current task", unread: false },
          { id: "2", projectId: "p1", title: "Same project", unread: false },
          { id: "3", projectId: "p2", title: "Other project", unread: false },
        ],
      }),
    );
  });
  await page.reload();
  await page.locator('.task-list button[title="Current task"]').click();
  await page.evaluate(() => (window as any).fixtureTaskStatus("3", "working"));
  await expect(page.locator(".background-tasks")).toHaveCount(0);
  await page.evaluate(() => (window as any).fixtureTaskStatus("2", "working"));
  await expect(page.locator(".background-tasks")).toContainText(
    "1 tasks are running in the background",
  );
  await page.locator('.task-list button[title="Other project"]').click();
  await expect(page.locator(".background-tasks")).toHaveCount(0);
});

test("Pi packages stay separate from desktop plugins and support both scopes", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pi packages", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Package source" }).fill("npm:example-pi");
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator(".plugin-card")).toContainText("npm:example-pi");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.packageAction") ?? "{}").op),
    )
    .toBe("package.install");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.packageAction") ?? "{}").op),
    )
    .toBe("package.update");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No Pi packages installed.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.packageAction") ?? "{}").op),
    )
    .toBe("package.remove");
  await page.getByRole("combobox", { name: "Install scope" }).selectOption("project");
  await page.getByRole("textbox", { name: "Package source" }).fill("npm:project-pi");
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator(".plugin-card")).toContainText("npm:project-pi");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.packageAction") ?? "{}").scope,
    ),
  ).toBe("project");
});

test("Pi skills use native paths and show discovered skills", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pi skills", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Skill file or directory" })
    .fill("/home/test/skills/review");
  await page.getByRole("button", { name: "Add skill" }).click();
  await expect(page.getByText("review", { exact: true })).toBeVisible();
  await expect(page.getByText("/home/test/skills/review")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").op),
    )
    .toBe("skill.add");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").projectId,
    ),
  ).toBe("p1");
  await page.getByRole("button", { name: "Disable review" }).click();
  await expect(page.getByRole("button", { name: "Enable review" })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").enabled,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No additional skill paths.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").op),
    )
    .toBe("skill.remove");
});

test("Pi package skills show source and can be toggled", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "fixture.skillResources",
      JSON.stringify([
        {
          name: "package-skill",
          path: "/home/test/.pi/agent/npm/example/skills/package-skill/SKILL.md",
          scope: "user",
          origin: "package",
          source: "npm:example",
          enabled: true,
        },
      ]),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "Pi skills", exact: true }).click();
  await expect(page.getByText("npm:example")).toBeVisible();
  await page.getByRole("button", { name: "Disable package-skill" }).click();
  await expect(page.getByRole("button", { name: "Enable package-skill" })).toBeVisible();
});

test("Pi skills support project paths, overrides, and slash commands", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pi skills", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Skill file or directory" })
    .fill("/home/test/skills/user-review");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.getByRole("combobox", { name: "Skill scope" }).selectOption("project");
  await page
    .getByRole("textbox", { name: "Skill file or directory" })
    .fill("/projects/Pion/.pi/skills/project-review");
  await page.getByRole("button", { name: "Add skill" }).click();
  await expect(page.getByText("project-review", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").scope,
    ),
  ).toBe("project");
  await page.getByRole("combobox", { name: "Project override user-review" }).selectOption("unload");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").state,
    ),
  ).toBe("unload");
  await expect(page.getByRole("combobox", { name: "Project override user-review" })).toHaveValue(
    "unload",
  );
  await page
    .getByRole("combobox", { name: "Project override user-review" })
    .selectOption("inherit");
  await page
    .getByRole("combobox", { name: "Show /skill:name commands in the command menu" })
    .selectOption("disabled");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").scope,
    ),
  ).toBe("project");
  await page.getByRole("combobox", { name: "Skill scope" }).selectOption("user");
  await page
    .getByRole("checkbox", { name: "Show /skill:name commands in the command menu" })
    .uncheck();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture.skillAction") ?? "{}").state,
    ),
  ).toBe("disabled");
});

test("model services connect providers and edit custom models", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pi models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model services" })).toBeVisible();
  await page.getByRole("button", { name: "Configure OpenAI" }).click();
  await page.getByLabel("OpenAI API Key").fill("sk-test-secret");
  await page.getByRole("button", { name: /Save and connect/ }).click();
  await expect(page.getByText("API key saved. Reopen tasks to apply changes.")).toBeVisible();
  await expect(page.getByText("sk-test-secret")).toHaveCount(0);
  await page.getByRole("radio", { name: "Pi login" }).check();
  await expect(page.getByRole("combobox", { name: "Provider" })).toHaveValue("openai-codex");
  await page.getByRole("button", { name: "Sign in with Pi" }).click();
  await page.getByRole("combobox", { name: "Choose login method" }).selectOption("browser");
  await page.getByRole("button", { name: "Continue login" }).click();
  await expect(page.getByRole("link", { name: "https://example.test/login" })).toBeVisible();
  await page.getByRole("link", { name: "https://example.test/login" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.modelAuthUrl")))
    .toBe("https://example.test/login");
  await page.getByRole("textbox", { name: "Paste authorization code" }).fill("test-code");
  await page.getByRole("button", { name: "Continue login" }).click();
  await expect(
    page.getByText("Pi login completed. Reopen the task to use its models."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("fixture.modelAuthResponse") ?? "{}").value,
      ),
    )
    .toBe("test-code");

  await page.getByRole("button", { name: "Add custom endpoint", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Ollama/ })
    .click();
  await expect(page.getByRole("textbox", { name: "Provider ID" })).toHaveValue("ollama-local");
  await page.screenshot({ path: "test-results/endpoint-dialog.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-results/endpoint-dialog-dark.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("textbox", { name: "Provider ID" }).fill("ollama");
  await page.getByRole("textbox", { name: "Base URL" }).fill("http://localhost:11434/v1");
  await page.getByRole("button", { name: "Test connection (Ping)" }).click();
  await expect(page.getByText("● 200 OK (14ms)")).toBeVisible();
  await page.getByRole("button", { name: "Save and connect" }).click();
  await expect(page.getByText("ollama", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Fetch model list/ }).click();
  await page.screenshot({ path: "test-results/discovery-dialog.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-results/discovery-dialog-dark.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await expect(page.getByText("3 models found")).toBeVisible();
  await page.getByRole("textbox", { name: "Search available models" }).fill("qwen");
  await page.getByRole("button", { name: "Select shown" }).click();
  await page.getByRole("button", { name: "Add selected models (1)" }).click();
  await expect(page.getByText("qwen2.5-coder:7b")).toBeVisible();
  await page.getByRole("button", { name: /Fetch model list/ }).click();
  await expect(page.getByText("Already added").first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("fixture.modelConfigAction") ?? "{}").action,
      ),
    )
    .toBe("model.import");
  await page
    .getByRole("button", { name: /Add model/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Model ID" }).fill("manual-model");
  await page.getByRole("textbox", { name: "Display name" }).fill("Manual model");
  await page.getByRole("spinbutton", { name: /Context window/ }).fill("128000");
  await page.screenshot({ path: "test-results/model-details.png", fullPage: true });
  await page.getByRole("button", { name: /Save model/ }).click();
  await expect(page.getByRole("button", { name: "manual-model" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("fixture.modelConfigAction") ?? "{}").action,
      ),
    )
    .toBe("model.save");

  await page.getByRole("button", { name: "Add custom endpoint", exact: true }).click();
  await page.getByRole("button", { name: "API key only" }).click();
  await page.getByRole("combobox", { name: "Provider ID" }).fill("google");
  await page.getByLabel("API key", { exact: true }).fill("google-test-key");
  await page.getByRole("button", { name: /Save API key/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("fixture.modelAuthAction") ?? "{}").provider,
      ),
    )
    .toBe("google");
});

test("compact composer fits a narrow window and its menu closes accessibly", async ({ page }) => {
  await taskFixture(page);
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Small composer");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Small composer");
  const composer = page.locator(".core-composer");
  const bounds = await composer.boundingBox();
  const more = await page.getByRole("button", { name: "More options" }).boundingBox();
  const send = await page.getByRole("button", { name: "Send to Pi" }).boundingBox();
  expect(
    bounds && more && send && more.x >= bounds.x && send.x + send.width <= bounds.x + bounds.width,
  ).toBeTruthy();
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("combobox", { name: "Thinking" })).toBeVisible();
  await page.screenshot({ path: "test-results/compact-composer.png" });
  await page.getByRole("button", { name: "More options" }).press("Escape");
  await expect(page.getByRole("combobox", { name: "Thinking" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More options" })).toBeFocused();
});

test("model picker groups repeated names and filters a long catalog", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => {
    const names = [
      "GPT-5.3 Codex Spark",
      "GPT-5.5",
      "GPT-5.6 Luna",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "GPT-6 Astra",
      "GPT-6 Luna",
    ];
    const models = ["openai", "openrouter", "metis"].flatMap((provider) =>
      names.map((name) => ({ provider, id: name.toLowerCase().replaceAll(" ", "-"), name })),
    );
    localStorage.setItem("fixture.models", JSON.stringify(models));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Model", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Model" });
  await expect(menu.getByRole("heading", { name: "openai" })).toBeVisible();
  await expect(menu.getByRole("heading", { name: "openrouter" })).toHaveCount(1);
  const results = page.locator(".model-picker-results");
  expect(
    await results.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/model-picker.png" });
  await menu.getByRole("searchbox", { name: "Search models" }).fill("sol");
  await expect(menu.getByRole("button", { name: /GPT-5.6 Sol/ })).toHaveCount(3);
  await menu.getByRole("button", { name: "GPT-5.6 Sol · openrouter" }).click();
  await expect(page.getByRole("button", { name: "Model", exact: true })).toContainText(
    "GPT-5.6 Sol",
  );
  expect(await page.evaluate(() => localStorage.getItem("pion.newTaskModel.p1"))).toBe(
    "openrouter/gpt-5.6-sol",
  );
});

test("theme follows the system, persists an override and sidebar controls stay local", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await taskFixture(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.locator(".app")).toHaveClass(/rail-collapsed/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pion.railCollapsed")))
    .toBe("true");
});

test("compact sidebar shows colored project initials and switches projects", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.catalog",
      JSON.stringify({
        projects: [
          { id: "p1", name: "Pion", path: "/projects/Pion" },
          { id: "p2", name: "Pioneer", path: "/projects/Pioneer" },
          { id: "p3", name: "Pinn", path: "/projects/Pinn" },
        ],
        tasks: [],
      }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "Hide sidebar" }).click();

  const projects = page.locator(".project-row button:first-child");
  await expect(projects.nth(0).locator(".project-initials")).toHaveText("P");
  await expect(projects.nth(1).locator(".project-initials")).toHaveText("P");
  await expect(projects.nth(2).locator(".project-initials")).toHaveText("P");
  await expect(projects.nth(0).locator(".project-initials")).toBeVisible();
  await expect(projects.nth(0).locator(".project-name")).toBeHidden();
  await expect(projects.nth(0)).toHaveAttribute("aria-label", "Pion");
  const colors = await projects
    .locator(".project-initials")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(colors).size).toBe(3);
  await expect(projects.nth(0)).toHaveAttribute("aria-current", "true");
  await projects.nth(1).click();
  await expect(projects.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".app")).toHaveClass(/rail-collapsed/);

  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(projects.nth(0).locator(".project-initials")).toBeVisible();
  await expect(projects.nth(0).locator(".project-name")).toBeHidden();
  await projects.nth(0).click();
  await expect(projects.nth(0)).toHaveAttribute("aria-current", "true");
});

test("task search, state filters and project collapse preserve grouped navigation", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.catalog",
      JSON.stringify({
        projects: [{ id: "p1", name: "Pion", path: "/projects/Pion" }],
        tasks: [
          { id: "1", projectId: "p1", title: "Running task" },
          { id: "2", projectId: "p1", title: "Unread task", unread: true },
        ],
      }),
    );
  });
  await page.reload();
  await page.evaluate(() => (window as any).fixtureTaskStatus("1", "working"));
  await page.getByRole("button", { name: "Search tasks" }).click();

  await page
    .locator(".task-filters")
    .getByRole("button", { name: /Running/ })
    .click();
  await expect(page.locator('.task-list button[title="Running task"]')).toBeVisible();
  await expect(page.locator('.task-list button[title="Unread task"]')).toHaveCount(0);
  await page
    .locator(".task-filters")
    .getByRole("button", { name: /Attention/ })
    .click();
  await expect(page.locator('.task-list button[title="Unread task"]')).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();

  await page.getByRole("textbox", { name: "Search tasks" }).fill("unread");
  await expect(page.locator('.task-list button[title="Unread task"]')).toBeVisible();
  await expect(page.locator('.task-list button[title="Running task"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("");
  await page.locator(".project-row button").first().click();
  await expect(page.locator(".task-list")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pion.collapsedProjects")))
    .toContain("p1");
});

test("usage and task menus load on demand, recover from failure and restore focus", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Usage task");
  await page.getByRole("button", { name: "Start task" }).click();

  await page.evaluate(() => localStorage.setItem("fixture.failStats", "yes"));
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(page.getByText(/Usage unavailable for test/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Usage", exact: true })).toBeFocused();
  await page.evaluate(() => localStorage.removeItem("fixture.failStats"));
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(page.getByText("1,200 / 12,000")).toBeVisible();
  await expect(page.getByText("$0.0120")).toBeVisible();

  await page.keyboard.press("Escape");
  await openTaskActions(page);
  await expect(page.getByRole("menuitem", { name: "History", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Task actions" })).toBeFocused();
  await page.evaluate(() => (window as any).fixturePiEvent({ type: "agent_start" }));
  await openTaskActions(page);
  await expect(page.getByRole("menuitem", { name: "History", exact: true })).toBeDisabled();
});

test("project picker selection and plugin lifecycle remain available inside settings", async ({
  page,
}) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue("p2");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Other project task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".topbar")).toContainText("Other");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Desktop plugins", exact: true }).click();
  await page.getByRole("textbox", { name: "Local plugin folder or ZIP" }).fill("/plugin");
  await page.getByRole("button", { name: "Review installation" }).click();
  await page.getByRole("button", { name: "Approve & enable" }).click();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByText("agent-chat · disabled")).toBeVisible();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByText("agent-chat · active")).toBeVisible();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("agent-chat · active")).toBeVisible();
  await page.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(page.getByText("No plugins installed yet.")).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.screenshot({ path: "test-results/new-task.png", fullPage: true });
});

test("plugin review explains write and network permissions with allowlists", async ({ page }) => {
  const demo = JSON.parse(readFileSync("examples/plugin-api-demo/plugin.json", "utf8"));
  await taskFixture(page);
  await page.goto("/");
  await page.evaluate(
    (manifest) => localStorage.setItem("fixture.reviewManifest", JSON.stringify(manifest)),
    demo,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Desktop plugins", exact: true }).click();
  await page.getByRole("textbox", { name: "Local plugin folder or ZIP" }).fill("/plugin");
  await page.getByRole("button", { name: "Review installation" }).click();
  await expect(
    page.getByText("Write files only under the allowlisted workspace paths"),
  ).toBeVisible();
  await expect(page.getByText("Allowed paths: pion-plugin-demo.md, plugin-demo/**")).toBeVisible();
  await expect(
    page.getByText("Make network requests only to allowlisted hosts, proxied through the host"),
  ).toBeVisible();
  await expect(page.getByText("Allowed hosts: example.com")).toBeVisible();
});

test("sandbox denies network, host DOM, Tauri, other plugin commands, and undeclared APIs", async ({
  page,
}) => {
  const manifest = {
    id: "probe",
    name: "Probe",
    version: "0.1.0",
    apiVersion: "1",
    minDesktopVersion: "0.1.0",
    main: "index.js",
    permissions: [],
    contributes: {
      commands: [],
      panels: [{ id: "probe.panel", title: "Probe", location: "mainPanel" }],
    },
  };
  const source = `async function activate(context) {
    const results = [typeof document === 'undefined' ? 'NO_DOM' : 'FAIL_DOM', typeof __TAURI_INTERNALS__ === 'undefined' ? 'NO_TAURI' : 'FAIL_TAURI'];
    try { await fetch('https://example.com'); results.push('FAIL_NETWORK'); } catch { results.push('NO_NETWORK'); }
    try { await context.pi.prompt('forbidden'); results.push('FAIL_PERMISSION'); } catch { results.push('NO_PERMISSION'); }
    try { await context.commands.execute('core.connect'); results.push('FAIL_COMMAND'); } catch { results.push('NO_COMMAND'); }
    context.ui.registerPanel('probe.panel', {type:'text',text:results.join(' ')});
  }`;
  await page.addInitScript(
    (records) => localStorage.setItem("pion.preview.plugins", JSON.stringify(records)),
    [installed(manifest, source)],
  );
  await page.goto("/");
  await expect(page.locator('[data-panel="probe.panel"]')).toContainText(
    "NO_DOM NO_TAURI NO_NETWORK NO_PERMISSION NO_COMMAND",
  );
});

test("extended declarative views render tables, code, diffs, images and inputs", async ({
  page,
}) => {
  const manifest = {
    id: "views",
    name: "Views",
    version: "0.1.0",
    apiVersion: "1",
    minDesktopVersion: "0.1.0",
    main: "index.js",
    permissions: [],
    contributes: {
      commands: [{ id: "views.go", title: "Go" }],
      panels: [{ id: "views.panel", title: "Views", location: "mainPanel" }],
    },
  };
  const source = `async function activate(context) {
    context.ui.registerPanel('views.panel', {
      type: 'stack',
      children: [
        { type: 'text', text: 'Extended views', tone: 'heading' },
        { type: 'table', columns: [{ key: 'k', label: 'Key' }, { key: 'v', label: 'Value' }],
          rows: [{ k: 'alpha', v: '1' }, { k: 'beta', v: '2' }] },
        { type: 'code', text: 'const answer = 42;', language: 'ts' },
        { type: 'diff', text: '@@ hunk @@\\n+added line\\n-removed line' },
        { type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', alt: 'demo dot' },
        { type: 'input', command: 'views.go', placeholder: 'Type here', submit: 'Send' },
      ],
    });
  }`;
  await page.addInitScript(
    (records) => localStorage.setItem("pion.preview.plugins", JSON.stringify(records)),
    [installed(manifest, source)],
  );
  await page.goto("/");
  const panel = page.locator('[data-panel="views.panel"]');
  await expect(panel).toContainText("Extended views");
  await expect(panel).toContainText("alpha");
  await expect(panel).toContainText("const answer = 42;");
  await expect(panel).toContainText("added line");
  await expect(panel.getByRole("img", { name: "demo dot" })).toBeVisible();
  await expect(panel.getByPlaceholder("Type here")).toBeVisible();
});

test("workspace write, network and read are denied without permissions", async ({ page }) => {
  const manifest = {
    id: "gate",
    name: "Gate",
    version: "0.1.0",
    apiVersion: "1",
    minDesktopVersion: "0.1.0",
    main: "index.js",
    permissions: [],
    contributes: {
      commands: [{ id: "gate.run", title: "Run" }],
      panels: [{ id: "gate.panel", title: "Gate", location: "mainPanel" }],
    },
  };
  const source = `async function activate(context) {
    const results = [];
    try { await context.workspace.writeFile('x.md', 'x'); results.push('FAIL_WRITE'); } catch { results.push('NO_WRITE'); }
    try { await context.network.fetch('https://example.com'); results.push('FAIL_NETWORK'); } catch { results.push('NO_NETWORK'); }
    try { await context.workspace.readFile('x.md'); results.push('FAIL_READ'); } catch { results.push('NO_READ'); }
    context.ui.registerPanel('gate.panel', { type: 'text', text: results.join(' ') });
  }`;
  await page.addInitScript(
    (records) => localStorage.setItem("pion.preview.plugins", JSON.stringify(records)),
    [installed(manifest, source)],
  );
  await page.goto("/");
  await expect(page.locator('[data-panel="gate.panel"]')).toContainText(
    "NO_WRITE NO_NETWORK NO_READ",
  );
});

test("a deadlocked plugin times out without freezing the shell or a subsequent plugin", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("pion.locale", "en"));
  const manifest = {
    ...builtin,
    id: "broken",
    name: "Broken",
    permissions: [],
    contributes: { commands: [], panels: [] },
  };
  await page.addInitScript(
    (records) => localStorage.setItem("pion.preview.plugins", JSON.stringify(records)),
    [installed(manifest, "function activate() { while (true) {} }"), installed(hello, helloSource)],
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Desktop plugins", exact: true }).click();
  await expect(page.getByText(/Activation timed out/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("hello-plugin · active")).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your task" })).toBeVisible();
});

test("sandbox boots under production CSP containing Tauri script hashes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pion.locale", "en"));
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const hashes = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`)
      .join(" ");
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "Content-Security-Policy": `default-src 'self'; script-src 'self' blob: 'sha256-${bridgeHash}' ${hashes}; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; worker-src blob:; connect-src 'self' ws://127.0.0.1:1420`,
      },
    });
  });
  await page.addInitScript(
    (records) => localStorage.setItem("pion.preview.plugins", JSON.stringify(records)),
    [installed(hello, helloSource)],
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Desktop plugins", exact: true }).click();
  await expect(page.getByText("hello-plugin · active")).toBeVisible();
});

test.describe("Chinese interface", () => {
  test.use({ locale: "zh-CN" });

  test("follows system language, translates approval and plugins, switches live and persists", async ({
    page,
  }) => {
    await taskFixture(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.getByRole("textbox", { name: "描述你的任务" }).fill("中文任务");
    await page.getByRole("button", { name: "开始任务" }).click();
    await expect(page.getByRole("button", { name: "发送给 Pi" })).toBeVisible();
    await page.getByRole("textbox", { name: /让 Pi 帮你/ }).fill("用户草稿 $& stays unchanged");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("combobox", { name: /界面语言/ }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator(".task-list").getByRole("button", { name: "中文任务" }).click();
    await expect(page.getByRole("textbox", { name: /Ask Pi/ })).toHaveValue(
      "用户草稿 $& stays unchanged",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /Language/ })).toHaveValue("en");
    await page.getByRole("combobox", { name: /Language/ }).selectOption("zh-CN");
    await page.locator(".task-list").getByRole("button", { name: "中文任务" }).click();
    await expect(page.getByRole("button", { name: "发送给 Pi" })).toBeVisible();
    await page.screenshot({ path: "test-results/i18n-zh.png", fullPage: true });
  });

  test("legacy plugins retain their own labels under Chinese shell", async ({ page }) => {
    const manifest = JSON.parse(readFileSync("examples/hello-plugin/plugin.json", "utf8"));
    const source = readFileSync("examples/hello-plugin/index.js", "utf8");
    await page.addInitScript(
      (record) => {
        localStorage.setItem("pion.locale", "unsupported");
        localStorage.setItem("pion.preview.plugins", JSON.stringify([record]));
      },
      installed(manifest, source),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "桌面插件", exact: true }).click();
    await expect(page.getByText("hello-plugin · 已启用")).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(manifest.name) })).toBeVisible();
  });
});
