import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/v1/problems/by-slug/focus")
      return route.fulfill({ json: {
        id: "focus", slug: "focus", title: "Editor focus", difficulty: "BEGINNER",
        timeLimitMs: 1000, memoryLimitMb: 256, status: "PUBLISHED",
        statementMarkdown: "Focus", inputDescriptionMarkdown: "", outputDescriptionMarkdown: "",
        samples: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
      } });
    return route.fulfill({ status: 404, json: { message: "Unexpected focus fixture request" } });
  });
  await page.goto("/problems/view/focus");
});

for (const key of ["Tab", "Shift+Tab"]) {
  test(`Escape then ${key} leaves the editor without editing or losing its draft`, async ({ page }) => {
    const editor = page.getByLabel("소스 코드");
    await editor.fill("private draft");
    await expect(editor).toHaveAccessibleDescription(/Esc 다음 Tab.*Shift\+Tab/);
    await page.keyboard.press("Escape");
    await expect(editor).toBeFocused();
    await page.keyboard.press(key);
    await expect(editor).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    await expect(editor).toHaveValue("private draft");
    expect(await page.evaluate(() => localStorage.getItem("unsolvable-oj-draft-v1:focus:PYTHON"))).toBe("private draft");
  });
}

test("normal Tab indentation survives escape cancellation and refocusing", async ({ page }) => {
  const editor = page.getByLabel("소스 코드");
  await editor.fill("");
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("    ");
  await page.keyboard.press("Shift+Tab");
  await expect(editor).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("     ");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Editor focus", exact: true }).click();
  await editor.focus();
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("         ");
});

test("Escape closes completion and releases snippet Tab navigation", async ({ page }) => {
  const editor = page.getByLabel("소스 코드");
  const suggestions = page.getByRole("listbox", { name: "자동완성 제안" });
  await editor.fill("");
  await editor.pressSequentially("fori");
  await expect(suggestions).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(suggestions).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue("fori");

  await editor.fill("");
  await editor.pressSequentially("fori");
  await suggestions.getByRole("option", { name: /^fori/ }).click();
  const snippet = await editor.inputValue();
  expect(snippet).toContain("for ");
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Tab");
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue(snippet);
});

for (const modifier of ["Control", "Meta"]) {
  test(`${modifier}+Enter cancels an armed focus exit`, async ({ page }) => {
    const editor = page.getByLabel("소스 코드");
    await editor.fill("value");
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${modifier}+Enter`);
    await page.keyboard.press("Tab");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("value    ");
  });
}

for (const event of [
  { key: "Process", isComposing: true },
  { key: "Unidentified", keyCode: 229 },
]) {
  test(`the synthetic ${event.key} guard cancels an armed exit without editing`, async ({ page }) => {
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await page.keyboard.press("Escape");
    await editor.dispatchEvent("keydown", event);
    await expect(editor).toHaveValue("");
    await page.keyboard.press("Tab");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("    ");
  });
}
