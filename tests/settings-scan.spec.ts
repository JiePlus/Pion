import { expect, test } from "@playwright/test";
import { taskFixture } from "./task-fixture";

test("settings auto-detect Pi installations and let the user pick or edit", async ({ page }) => {
  await taskFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByText("Detected Pi installations")).toBeVisible();
  await page.getByRole("button", { name: /nvm\/versions\/node\/v22\.19\.0\/bin\/pi/ }).click();
  await expect(page.getByLabel("Pi executable")).toHaveValue(
    "/Users/test/.nvm/versions/node/v22.19.0/bin/pi",
  );

  // Detection only prefills; the path stays editable for manual correction.
  await page.getByLabel("Pi executable").fill("/opt/custom/pi");
  await expect(page.getByLabel("Pi executable")).toHaveValue("/opt/custom/pi");
  await expect(page.getByRole("button", { pressed: true, name: /nvm/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("fixture.savedExecutable"))).toBeNull();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("fixture.savedExecutable")))
    .toBe("/opt/custom/pi");
});

test("an empty Pi scan keeps manual configuration and supports a retry", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => localStorage.setItem("fixture.piCandidates", "[]"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("No Pi installation found. Enter the executable path manually."),
  ).toBeVisible();
  await page.getByLabel("Pi executable").fill("/opt/manual/pi");
  await page.evaluate(() => {
    localStorage.setItem(
      "fixture.piCandidates",
      JSON.stringify([{ executable: "/opt/detected/pi", version: "0.87.0" }]),
    );
    localStorage.setItem("fixture.delayPiScan", "yes");
  });
  await page.getByRole("button", { name: "Scan again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Scanning…", exact: true })).toBeDisabled();
  await page.getByLabel("Pi executable").fill("/opt/corrected/pi");
  await expect(page.getByRole("button", { name: /\/opt\/detected\/pi/ })).toBeVisible();
  await expect(page.getByLabel("Pi executable")).toHaveValue("/opt/corrected/pi");
});

test("a failed Pi scan leaves manual editing usable and recovers on retry", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => localStorage.setItem("fixture.failPiScan", "yes"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Pi scan failed");
  await page.getByLabel("Pi executable").fill("/opt/manual/pi");
  await page.evaluate(() => localStorage.removeItem("fixture.failPiScan"));
  await page.getByRole("button", { name: "Scan again", exact: true }).click();
  await expect(page.getByRole("button", { name: /\/usr\/local\/bin\/pi/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Pi executable")).toHaveValue("/opt/manual/pi");
});
