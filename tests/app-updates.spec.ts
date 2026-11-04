import { expect, test } from "@playwright/test";
import { taskFixture } from "./task-fixture";

test("Pion updates section reports the installed version", async ({ page }) => {
  await taskFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pion updates" })).toBeVisible();
  await expect(page.getByText("Current version: 0.1.0")).toBeVisible();
  await expect(page.getByText("Pion is up to date.")).toBeVisible();
});

test("Pion installs a new release silently in the background", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "fixture.appUpdate",
      JSON.stringify({ version: "0.2.0", date: "2026-11-01T00:00:00Z", body: "Fixes" }),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Update installed — restart Pion to finish.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart Pion" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fixture.appUpdateInstalled"))).toBe("yes");
  await page.getByRole("button", { name: "Restart Pion" }).click();
  expect(await page.evaluate(() => localStorage.getItem("fixture.appRelaunched"))).toBe("yes");
});

test("disabling background installs lets the user download on demand", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => {
    localStorage.setItem("pion.updates.autoInstall", "off");
    localStorage.setItem("fixture.appUpdate", JSON.stringify({ version: "0.3.0" }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Update 0.3.0 is available.")).toBeVisible();
  await page.getByRole("button", { name: "Download and install" }).click();
  await expect(page.getByText("Update installed — restart Pion to finish.").first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fixture.appUpdateInstalled"))).toBe("yes");
});

test("manual check stays idle until requested when auto check is off", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => localStorage.setItem("pion.updates.autoCheck", "off"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pion updates" })).toBeVisible();
  await expect(page.getByText("Pion is up to date.")).toHaveCount(0);
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("Pion is up to date.")).toBeVisible();
});
