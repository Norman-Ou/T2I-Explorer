import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function buildComparison(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Evaluation set").selectOption("sample-eval");
  await page.getByRole("button", { name: "Add Model A · 1000" }).click();
  await page.getByRole("button", { name: "Add Model B · 2000" }).click();
  await expect(page.getByText("4 aligned rows")).toBeVisible();
}

test("compares model-owned records, gaps, details, and shareable state", async ({ page }) => {
  await buildComparison(page);
  await expect(page.getByText("A red square on a white background")).toBeVisible();
  await expect(page.getByText("A scarlet geometric tile")).toBeVisible();
  await expect(page.getByText("No record", { exact: true })).toHaveCount(2);

  const imageButton = page.getByRole("button", { name: "Open generated image for prompt ID 1, Model B, step 2000" });
  await imageButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Model B · step 2000 · prompt ID 1" })).toBeVisible();
  await expect(dialog.getByText("metadata")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(imageButton).toBeFocused();

  await page.getByLabel("Search prompts").fill("greenhouse");
  await expect(page.getByText("1 aligned rows")).toBeVisible();
  await expect(page).toHaveURL(/q=greenhouse/);
  const url = page.url();
  await page.goto(url);
  await expect(page.getByText("A glass greenhouse in winter")).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove Model A/ })).toBeVisible();
});

test("supports keyboard column reorder, deterministic shuffle, and navigation resizing", async ({ page }) => {
  await buildComparison(page);
  const source = await page.getByRole("button", { name: "Drag Model A, step 1000" }).boundingBox();
  const target = await page.getByRole("button", { name: "Drag Model B, step 2000" }).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/cols=model-b%3A2000%2Cmodel-a%3A1000/);
  await page.getByRole("button", { name: "Move Model B right" }).click();
  await expect(page).toHaveURL(/cols=model-a%3A1000%2Cmodel-b%3A2000/);
  await page.getByRole("button", { name: "Shuffle" }).click();
  await expect(page).toHaveURL(/order=shuffle/);
  await page.reload();
  await expect(page.getByText("4 aligned rows")).toBeVisible();

  const separator = page.getByRole("separator", { name: "Resize navigation" });
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toBeFocused();
});

test("has no automatically detectable serious accessibility violations", async ({ page }) => {
  await buildComparison(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("keeps the application chrome usable at a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "T2I Explorer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Hide navigation" }).click();
  await expect(page.getByRole("button", { name: "Show navigation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
});
