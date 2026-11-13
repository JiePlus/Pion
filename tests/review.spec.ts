import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { taskFixture } from "./task-fixture";

async function startTask(page: Page) {
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Review task");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Review task");
}

async function openReview(page: Page) {
  await page.addInitScript(() => localStorage.setItem("pion.locale", "en"));
  await taskFixture(page);
  await page.goto("/");
  await startTask(page);
  const toggle = page.getByRole("button", { name: "Review changes" });
  await expect(toggle).toContainText("+3");
  await toggle.click();
  const pane = page.getByRole("complementary", { name: "Review" });
  await expect(pane).toBeVisible();
  return pane;
}

const calls = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("fixture.gitCalls") ?? "[]"));

test("review pane shows uncommitted files and stages a single hunk", async ({ page }, info) => {
  const pane = await openReview(page);
  await expect(pane.getByRole("radio", { name: "Unstaged 2" })).toBeChecked();
  const file = pane.locator('[data-path="src/a.ts"]');
  await expect(file).toContainText("+2");
  await expect(file).toContainText("−1");
  await expect(file.locator(".line-add")).toHaveCount(2);
  await expect(pane.locator('[data-path="notes.md"]')).toContainText("U");

  mkdirSync("artifacts/ui-qa", { recursive: true });
  await page.screenshot({ path: `artifacts/ui-qa/${info.project.name}-review-pane.png` });

  await file.getByRole("button", { name: "Stage hunk" }).first().click();
  await expect(pane.getByRole("radio", { name: "Staged 1" })).toBeVisible();
  const staged = (await calls(page)).find((call: { op: string }) => call.op === "git.hunk");
  expect(staged).toMatchObject({ action: "stage", path: "src/a.ts" });
  expect(staged.hunk).toBe("@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n");

  await pane.getByRole("radio", { name: "Staged 1" }).click();
  await expect(pane.locator('[data-path="src/a.ts"] .line-del')).toHaveCount(1);
  await pane.getByRole("button", { name: "Unstage hunk" }).click();
  await expect(pane).toContainText("Nothing is staged.");
});

test("revert asks for a second click before discarding", async ({ page }) => {
  const pane = await openReview(page);
  const notes = pane.locator('[data-path="notes.md"]');
  await notes.hover();
  await notes.getByRole("button", { name: "Delete" }).click();
  expect((await calls(page)).some((call: { op: string }) => call.op === "git.revert")).toBe(false);
  await notes.getByRole("button", { name: "Confirm delete" }).click();
  await expect(notes).toHaveCount(0);
});

test("commit dialog commits, pushes and opens a pull request", async ({ page }, info) => {
  const pane = await openReview(page);
  await pane.getByRole("button", { name: "Commit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Commit your changes" });
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  await dialog.getByRole("textbox", { name: "Commit message" }).fill("feat: review pane");
  await dialog.getByRole("menuitemradio", { name: "Commit and create PR" }).click();
  await page.screenshot({ path: `artifacts/ui-qa/${info.project.name}-review-commit.png` });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pane.getByRole("status")).toContainText(
    "Committed f00ba47 and opened a pull request",
  );
  await expect(pane.getByRole("link", { name: /pull\/7/ })).toBeVisible();
  const commit = (await calls(page)).find((call: { op: string }) => call.op === "git.commit");
  expect(commit).toMatchObject({ message: "feat: review pane", includeUnstaged: true, then: "pr" });
  await expect(pane).toContainText("No changes.");
});

test("branch menu switches and creates branches; scopes cover branch and last turn", async ({
  page,
}) => {
  const pane = await openReview(page);
  await pane.getByRole("button", { name: /main/ }).click();
  await page.getByRole("menuitemradio", { name: "feature/glass" }).click();
  await expect(pane.getByRole("status")).toContainText("Switched to feature/glass");
  await pane.getByRole("button", { name: /feature\/glass/ }).click();
  await page.getByRole("textbox", { name: "New branch name" }).fill("topic");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(pane.getByRole("status")).toContainText("Created and switched to topic");

  await pane.getByRole("radio", { name: "Branch" }).click();
  await expect(pane).toContainText("Compared with origin/main");
  await expect(pane.getByRole("button", { name: "Stage hunk" })).toHaveCount(0);
  await pane.getByRole("radio", { name: "Last turn" }).click();
  await expect(pane.locator(".line-add")).toContainText("twenty-one");
  await pane.getByRole("radio", { name: "Unstaged 2" }).click();
  await pane.getByRole("button", { name: "Close review" }).click();
  await expect(pane).toHaveCount(0);
});

test("a project without Git offers to initialize a repository", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fixture.gitNotRepo", "yes"));
  await page.addInitScript(() => localStorage.setItem("pion.review.open", "true"));
  await page.addInitScript(() => localStorage.setItem("pion.locale", "en"));
  await taskFixture(page);
  await page.goto("/");
  await startTask(page);
  const pane = page.getByRole("complementary", { name: "Review" });
  await expect(pane).toContainText("This project is not a Git repository.");
  await pane.getByRole("button", { name: "Initialize repository" }).click();
  await expect(pane.getByRole("radio", { name: "Unstaged 2" })).toBeVisible();

  // Before the first commit the current branch is still listed, marked as uncommitted.
  await pane.getByRole("button", { name: /main/ }).click();
  const current = page.getByRole("menuitemradio", { name: "main" });
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute("aria-description", "No commits yet");
  await expect(page.getByRole("menu", { name: "Branches" })).toContainText(
    "Branches are saved with the first commit",
  );
  await page.getByRole("textbox", { name: "New branch name" }).fill("topic");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(pane.getByRole("button", { name: /topic/ })).toBeVisible();
  await pane.getByRole("button", { name: /topic/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "topic" })).toBeVisible();
});

test("Git review is listed as a built-in plugin and can be switched off", async ({ page }) => {
  const pane = await openReview(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins" }).first().click();
  const card = page.locator(".plugin-card", { hasText: "git-review" });
  await expect(card).toContainText("Built-in");
  await expect(card).toContainText("Git review");
  await expect(card.getByRole("button", { name: "Uninstall" })).toHaveCount(0);
  await card.getByRole("button", { name: "Disable" }).click();
  await expect(card.getByRole("button", { name: "Enable" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins" }).first().click();
  await expect(page.locator(".plugin-card", { hasText: "git-review" })).toContainText("disabled");
  await page.getByText("Review task").first().click();
  await expect(page.locator(".core-chat")).toContainText("Reply for Review task");
  await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0);
  await expect(pane).toHaveCount(0);
});
