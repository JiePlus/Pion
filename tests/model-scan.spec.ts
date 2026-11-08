import { expect, test } from "@playwright/test";
import { taskFixture } from "./task-fixture";

test("model services auto-detect local endpoints and prefill the add dialog", async ({ page }) => {
  await taskFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Pi models", exact: true }).click();

  const localServices = page.getByRole("region", { name: "Local services" });
  await expect(localServices).toBeVisible();
  await expect(localServices.getByRole("button", { name: /Ollama/ })).toBeVisible();
  await expect(localServices.getByRole("button", { name: /LM Studio/ })).toBeVisible();

  await localServices.getByRole("button", { name: /Ollama/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Provider ID" })).toHaveValue("ollama-local");
  await expect(dialog.getByRole("textbox", { name: "Base URL" })).toHaveValue(
    "http://127.0.0.1:11434/v1",
  );

  // Detection only prefills; the user can still correct every field by hand.
  await dialog.getByRole("textbox", { name: "Provider ID" }).fill("ollama-edit");
  await expect(dialog.getByRole("textbox", { name: "Provider ID" })).toHaveValue("ollama-edit");
});

test("model services keep a manual endpoint path when nothing is detected", async ({ page }) => {
  await taskFixture(page);
  await page.addInitScript(() => localStorage.setItem("fixture.localScan", "[]"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Pi models", exact: true }).click();

  const localServices = page.getByRole("region", { name: "Local services" });
  await expect(localServices).toBeVisible();
  await expect(
    localServices.getByText(
      "No local model service detected. Add a custom endpoint from the toolbar.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add custom endpoint", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("No local model service detected. Enter the endpoint manually below."),
  ).toBeVisible();
  await dialog.getByRole("textbox", { name: "Provider ID" }).fill("my-gateway");
  await dialog.getByRole("textbox", { name: "Base URL" }).fill("http://127.0.0.1:9999/v1");
  await expect(dialog.getByRole("textbox", { name: "Provider ID" })).toHaveValue("my-gateway");
});
