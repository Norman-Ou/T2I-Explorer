import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("long exact prompts stay inside a single comparison column", async ({ page }) => {
  await page.route("**/api/v2/datasets/sft-e6.0-r30/refseg/sior-t", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.records[0].message_input_text = "Long validation prompt with categories and spatial relations. ".repeat(40);
    await route.fulfill({json:body});
  });
  await page.goto("/?dataset=sft-e6.0-r30&cols=refseg:sior-t:wrap");
  await expect(page.getByText("fixture-sior-t-1")).toBeVisible();
  const grid = await page.locator(".comparison-grid").boundingBox();
  const viewport = await page.locator(".comparison-scroll").boundingBox();
  expect(grid!.width).toBeLessThanOrEqual(viewport!.width + 2);
});
test("landing discovers datasets and restores duplicate named-step columns", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading",{name:"Text-to-Image Explorer",exact:true}).last()).toBeVisible();
  await expect(page.getByRole("button",{name:/sft-e6.0-r30/})).toBeVisible();
  await page.getByRole("button",{name:/sft-e6.0-r30/}).click();
  await page.getByRole("button",{name:"Add column"}).click();
  await page.getByRole("button",{name:"RefSeg →"}).click();
  await page.getByRole("button",{name:/RefSeg · SIOR_T/}).click();
  await expect(page.getByText("fixture-sior-t-1")).toBeVisible();
  await page.getByRole("button",{name:"Add column"}).click();
  await page.getByRole("button",{name:"RefSeg →"}).click();
  await page.getByRole("button",{name:/RefSeg · SIOR_T/}).click();
  await expect(page.getByRole("button",{name:/Remove RefSeg, SIOR_T/})).toHaveCount(2);
  await expect(page).toHaveURL(/cols=/);
  await page.reload();
  await expect(page.getByRole("button",{name:/Remove RefSeg, SIOR_T/})).toHaveCount(2);
  await page.getByRole("button",{name:/Open three-panel review for fixture-sior-t-1/}).first().click();
  const dialog = page.getByRole("dialog"); await expect(dialog.locator(".exact-text").first()).toBeVisible();
  await expect(dialog.getByText("(exact empty string)")).toBeVisible();
  await dialog.getByRole("button",{name:"Close"}).click();
});
test("Steps picker, search, keyboard resizing and accessibility", async ({ page }) => {
  await page.goto("/?dataset=sft-e6.0-r30&mode=steps", { waitUntil: "domcontentloaded" });
  await page.getByRole("button",{name:"Add column"}).click();
  await page.getByRole("button",{name:"SIOR_T →"}).click();
  await page.getByRole("button",{name:/RefSeg · SIOR_T/}).click();
  await page.getByLabel("Search examples").fill("fixture-sior-t-2");
  await expect(page.getByText("1 ordinal rows")).toBeVisible();
  const separator = page.getByRole("separator",{name:"Resize navigation"}); await separator.focus(); await separator.press("ArrowRight");
  expect(await new AxeBuilder({page}).analyze()).toHaveProperty("violations",[]);
});
test("chooser handles no published dataset and a single published dataset", async ({ page }) => {
  await page.route("**/api/v2/catalog", async (route) => {
    await route.fulfill({ json: { snapshot_id: "empty", datasets: [], diagnostics: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("0 datasets")).toBeVisible();
  await expect(page.getByText("No published datasets match this search.")).toBeVisible();
  await page.unroute("**/api/v2/catalog");
  await page.getByRole("button", { name: "Reload data" }).click();
  await expect(page.getByText("2 datasets")).toBeVisible();
  await page.route("**/api/v2/catalog", async (route) => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ json: { ...body, datasets: body.datasets.filter((item: { id: string }) => item.id === "sft-e6.0-r30") } });
  });
  await page.reload();
  await expect(page.getByText("1 datasets")).toBeVisible();
  await expect(page.getByRole("button",{name:/sft-e6.0-r30/})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Dataset"})).toHaveValue("");
});
