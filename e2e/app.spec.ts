import { expect, test, type Page } from "@playwright/test";
import { ANSWER, BANK, PAIRS, mockOllama } from "./mockAi";

test.beforeEach(async ({ page }) => { await mockOllama(page); });

/** First run: create a profile learning Spanish, then save the (mocked) local Ollama model. */
async function onboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create your profile" })).toBeVisible();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("First course").selectOption("es");
  await page.getByRole("button", { name: "Create profile" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Ollama found on this Mac")).toBeVisible();
  await sheet.getByRole("radio", { name: /Ollama/ }).click();
  await expect(sheet.getByLabel(/Model/)).toHaveValue("mock:latest");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.getByRole("radio", { name: /Ollama/ })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Cancel" }).click();
}

test("onboarding creates a profile and sets up local AI", async ({ page }) => {
  await onboard(page);
  await expect(page.getByText("Ollama · mock:latest")).toBeVisible();
  await page.reload(); // signed in again, AI still set up
  await page.getByRole("button", { name: "Learn" }).click();
  await expect(page.getByText("Greetings & Introductions")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

/** Answers whatever exercise is on screen with the mock's right answer; false once the lesson is over. */
async function answer(lesson: ReturnType<Page["getByRole"]>) {
  const button = (name: string) => lesson.getByRole("button", { name, exact: true });
  const opt = (text: string) => lesson.locator(".opt", { hasText: new RegExp(`^\\d?${text}$`) });
  if (await lesson.getByText("Lesson complete!").isVisible()) return false;
  for (const name of ["Continue", "Finish", "Can't speak now"]) if (await button(name).isVisible()) return button(name).click().then(() => true);
  if (await lesson.getByRole("heading", { name: "Match the pairs" }).isVisible()) {
    for (const [a, b] of PAIRS) { await opt(a).click(); await opt(b).click(); }
  } else if (await lesson.getByLabel("Your answer").isVisible()) {
    await lesson.getByLabel("Your answer").fill(ANSWER);
    await button("Check").click();
  } else if (await lesson.locator(".bank").isVisible()) {
    for (const w of BANK) await lesson.locator(".bank .tok", { hasText: w }).click();
    await button("Check").click();
  } else {
    await opt(ANSWER).click();
    await button("Check").click();
  }
  await expect(lesson.getByText("Correct!")).toBeVisible();
  return true;
}

async function runLesson(page: Page, step: RegExp) {
  await page.getByRole("button", { name: step }).click();
  const lesson = page.getByRole("dialog", { name: "Lesson" });
  await expect(lesson.getByRole("heading", { name: "New phrase" })).toBeVisible();
  for (let i = 0; await answer(lesson); i++) expect(i).toBeLessThan(30);
  await expect(lesson.getByText("100%")).toBeVisible(); // accuracy: every answer was right
  await lesson.getByRole("button", { name: "Done" }).click();
  await expect(lesson).toBeHidden();
}

// The first two steps cover all five renderers: learn, choice, match, speak (skipped), then input and word bank.
test("first lessons run every exercise type", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "Learn" }).click();
  await runLesson(page, /Basic Greetings/);
  await runLesson(page, /Introduce Yourself/);
});
