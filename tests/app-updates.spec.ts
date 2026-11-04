import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { taskFixture } from "./task-fixture";

async function openUpdateSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pion updates" })).toBeVisible();
}

async function updateCalls(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("fixture.appUpdateCalls") ?? "[]") as string[],
  );
}

async function availableUpdate(page: Page, flags: Record<string, string> = {}) {
  await taskFixture(page);
  await page.addInitScript((preferences) => {
    localStorage.setItem("fixture.appUpdate", JSON.stringify({ version: "0.2.0", body: "Fixes" }));
    for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value);
  }, flags);
}

test("Pion updates section reports the installed version", async ({ page }, testInfo) => {
  await taskFixture(page);
  await page.setViewportSize({ width: 1280, height: 1700 });
  await openUpdateSettings(page);
  await expect(page.getByText("Current version: 0.1.0")).toBeVisible();
  await expect(page.getByText("Pion is up to date.")).toBeVisible();
  if (testInfo.project.name === "chromium")
    await page.screenshot({ path: "pr-assets/after-updates.png" });
});

test("background updates download without installing or restarting", async ({ page }) => {
  await availableUpdate(page);
  await openUpdateSettings(page);
  await expect(
    page.getByText("Update downloaded — restart Pion to install.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeDisabled();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check", "plugin:updater|download"]);
  expect(await page.evaluate(() => localStorage.getItem("fixture.appUpdateInstalled"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("fixture.appRelaunched"))).toBeNull();

  await page.getByRole("button", { name: "Install and restart Pion", exact: true }).click();
  await expect
    .poll(() => updateCalls(page))
    .toEqual([
      "plugin:updater|check",
      "plugin:updater|download",
      "plugin:updater|install",
      "plugin:process|restart",
    ]);
  expect(await page.evaluate(() => localStorage.getItem("fixture.appUpdateInstalled"))).toBe("yes");
  expect(await page.evaluate(() => localStorage.getItem("fixture.appRelaunched"))).toBe("yes");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("fixture.appUpdateClosed") ?? "[]")),
  ).toEqual([1]);
});

test("disabling background downloads lets the user download on demand", async ({ page }) => {
  await availableUpdate(page, { "pion.updates.autoInstall": "off" });
  await openUpdateSettings(page);
  await expect(page.getByText("Update 0.2.0 is available.")).toBeVisible();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check"]);
  await page.getByRole("button", { name: "Download update", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Install and restart Pion", exact: true }),
  ).toBeVisible();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check", "plugin:updater|download"]);
});

test("manual checks do not download even when background downloads are enabled", async ({
  page,
}) => {
  await availableUpdate(page, { "pion.updates.autoCheck": "off" });
  await openUpdateSettings(page);
  expect(await updateCalls(page)).toEqual([]);
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByText("Update 0.2.0 is available.")).toBeVisible();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check"]);
});

test("download progress keeps checking disabled and preserves the staged release", async ({
  page,
}) => {
  await availableUpdate(page, { "fixture.holdAppUpdateDownload": "yes" });
  await openUpdateSettings(page);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText("Downloading update… 50%")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).fixtureReleaseAppUpdateDownload());
  await expect(
    page.getByRole("button", { name: "Install and restart Pion", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeDisabled();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check", "plugin:updater|download"]);
});

test("download failures can retry without checking again", async ({ page }) => {
  await availableUpdate(page, { "fixture.failAppUpdateDownload": "yes" });
  await openUpdateSettings(page);
  await expect(page.getByRole("alert")).toContainText("Download interrupted");
  await page.evaluate(() => localStorage.removeItem("fixture.failAppUpdateDownload"));
  await page.getByRole("button", { name: "Download update", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Install and restart Pion", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await updateCalls(page)).toEqual([
    "plugin:updater|check",
    "plugin:updater|download",
    "plugin:updater|download",
  ]);
});

test("installation failures retain the staged bytes and restart action", async ({ page }) => {
  await availableUpdate(page, { "fixture.failAppUpdateInstall": "yes" });
  await openUpdateSettings(page);
  await page.getByRole("button", { name: "Install and restart Pion", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Installation failed");
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("fixture.appRelaunched"))).toBeNull();
  await page.evaluate(() => localStorage.removeItem("fixture.failAppUpdateInstall"));
  await page.getByRole("button", { name: "Install and restart Pion", exact: true }).click();
  await expect
    .poll(() => updateCalls(page))
    .toEqual([
      "plugin:updater|check",
      "plugin:updater|download",
      "plugin:updater|install",
      "plugin:updater|install",
      "plugin:process|restart",
    ]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("relaunch failure retries restart without reinstalling or redownloading", async ({ page }) => {
  await availableUpdate(page, { "fixture.failAppRelaunch": "yes" });
  await openUpdateSettings(page);
  await page.getByRole("button", { name: "Install and restart Pion", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Restart failed");
  await expect(page.getByText("Update installed — restart Pion to finish.")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("fixture.failAppRelaunch"));
  await page.getByRole("button", { name: "Restart Pion", exact: true }).click();
  await expect
    .poll(() => updateCalls(page))
    .toEqual([
      "plugin:updater|check",
      "plugin:updater|download",
      "plugin:updater|install",
      "plugin:process|restart",
      "plugin:process|restart",
    ]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("repeated checks release old manifests and do not retain stale availability", async ({
  page,
}) => {
  await availableUpdate(page, { "pion.updates.autoInstall": "off" });
  await openUpdateSettings(page);
  await expect(page.getByText("Update 0.2.0 is available.")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("fixture.appUpdate"));
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByText("Pion is up to date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download update", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("fixture.appUpdateClosed") ?? "[]")),
  ).toEqual([1]);
});

test("manual check errors are visible and background check errors stay quiet", async ({ page }) => {
  await availableUpdate(page, { "fixture.failAppUpdateCheck": "yes" });
  await openUpdateSettings(page);
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Update check is offline");
  await page.evaluate(() => localStorage.removeItem("fixture.failAppUpdateCheck"));
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByText("Update 0.2.0 is available.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await updateCalls(page)).toEqual([
    "plugin:updater|check",
    "plugin:updater|check",
    "plugin:updater|check",
  ]);
});

test("turning off background downloads during a check prevents the pending download", async ({
  page,
}) => {
  await availableUpdate(page, { "fixture.holdAppUpdateCheck": "yes" });
  await openUpdateSettings(page);
  await page
    .getByRole("checkbox", {
      name: "Automatically download updates in the background",
      exact: true,
    })
    .uncheck();
  await page.evaluate(() => (window as any).fixtureReleaseAppUpdateCheck());
  await expect(page.getByText("Update 0.2.0 is available.")).toBeVisible();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check"]);
  expect(await page.evaluate(() => localStorage.getItem("pion.updates.autoInstall"))).toBe("off");
});

test("background download preference survives reload", async ({ page }) => {
  await availableUpdate(page);
  await openUpdateSettings(page);
  const preference = page.getByRole("checkbox", {
    name: "Automatically download updates in the background",
    exact: true,
  });
  await preference.uncheck();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(preference).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Download update", exact: true })).toBeVisible();
});

test("Chinese settings describe staging and explicit installation", async ({ page }) => {
  await availableUpdate(page, { "pion.locale": "zh-CN" });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pion 更新", exact: true })).toBeVisible();
  await expect(page.getByText("更新已下载，重启 Pion 以安装。").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "安装并重启 Pion", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "后台自动下载更新", exact: true })).toBeChecked();
  expect(await updateCalls(page)).toEqual(["plugin:updater|check", "plugin:updater|download"]);
});
