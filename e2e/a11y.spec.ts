// Accessibility (#34): axe on the main screens, and keyboard focus around sheets and lessons.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockOllama } from "./mockAi";

test.beforeEach(async ({ page }) => { await mockOllama(page); });

/** Serious and critical axe findings on the current page. Colour contrast of the default theme is a design call (#34). */
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function onboard(page: Page) {
  await page.goto("/");
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("First course").selectOption("es");
  await page.getByRole("button", { name: "Create profile" }).click();
  const sheet = page.getByRole("dialog", { name: "AI provider" });
  await expect(sheet.getByText("Ollama found on this Mac")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await sheet.getByRole("radio", { name: /Ollama/ }).click();
  const config = page.getByRole("dialog");
  await expect(config.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet")), "focus follows a sheet that replaces another").toBe(true);
  await config.getByRole("button", { name: "Save", exact: true }).click();
  await config.getByRole("button", { name: "Cancel" }).click();
}

test("main screens, a sheet and a lesson have no serious axe findings", async ({ page }) => {
  await onboard(page);
  expect(await axe(page)).toEqual([]); // Settings
  await page.getByRole("button", { name: "Learn" }).click();
  await expect(page.getByText("Greetings & Introductions")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: /Basic Greetings/ }).click();
  await expect(page.getByRole("dialog", { name: "Lesson" }).getByRole("heading", { name: "New phrase" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("a sheet takes focus, keeps Tab inside and gives focus back on Escape", async ({ page }) => {
  await onboard(page);
  await page.getByRole("tab", { name: "AI & voice" }).click();
  const opener = page.locator(".card", { hasText: "AI provider" }).getByRole("button", { name: "Change" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "AI provider" });
  await expect(sheet).toBeFocused();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a lesson takes focus and the app behind it can't be tabbed to", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "Learn" }).click();
  await page.getByRole("button", { name: /Basic Greetings/ }).click();
  const lesson = page.getByRole("dialog", { name: "Lesson" });
  await expect(lesson).toBeFocused();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !document.activeElement?.closest(".app, .bottom-nav"))).toBe(true);
  }
});
