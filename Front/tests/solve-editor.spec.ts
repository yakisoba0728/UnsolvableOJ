import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi, problem } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("each tab takes the draft from the moment it opened and does not sync live with other tabs of the same problem", async ({
  page,
}) => {
  await authenticate(page);
  await page
    .context()
    .route("**/api/v1/problems/by-slug/sum", (route) =>
      route.fulfill({ json: problem }),
    );
  await page.goto("/problems/view/sum");
  const first = page.getByLabel("소스 코드");
  await first.fill("print(1)");

  // 두 번째 탭은 열린 시점의 초안(첫 탭이 그때까지 쓴 내용)을 가져온다.
  const second = await page.context().newPage();
  await second.goto("/problems/view/sum");
  const secondEditor = second.getByLabel("소스 코드");
  await expect(secondEditor).toHaveValue("print(1)");

  // 그 뒤의 변경은 서로에게 실시간으로 전해지지 않는다(저장 이벤트가 도착할 시간을 충분히 준다).
  const settle = () => page.waitForTimeout(400);
  await first.fill("print(2)");
  await settle();
  await expect(secondEditor).toHaveValue("print(1)");
  await secondEditor.fill("print('B')");
  await settle();
  await expect(first).toHaveValue("print(2)");

  // 극단적인 값(빈 값, 아주 긴 값, 이모지, HTML·따옴표·제어 문자)도 다른 탭을 바꾸지 않는다.
  const extremes = [
    "",
    "x".repeat(60_000),
    "😀 한글 \u202e RTL ✓",
    '</textarea><script>alert("x")</script>\n\'quote\' "double" `tick`\t\\',
  ];
  for (const value of extremes) {
    await first.fill(value);
    await settle();
    await expect(secondEditor).toHaveValue("print('B')");
  }

  // 새로고침하면 그 시점에 저장돼 있던 초안(마지막으로 저장한 첫 탭의 값)을 가져온다.
  const last = extremes[extremes.length - 1];
  await second.reload();
  await expect(second.getByLabel("소스 코드")).toHaveValue(last);

  // 첫 탭의 '초기화'는 열려 있는 두 번째 탭에는 영향을 주지 않고, 새로 열면 초기 코드로 시작한다.
  await page.getByRole("button", { name: "초기화", exact: true }).click();
  await settle();
  await expect(second.getByLabel("소스 코드")).toHaveValue(last);
  await second.reload();
  await expect(second.getByLabel("소스 코드")).toHaveValue(/def solution\(\):/);
  await second.close();
});

test("every language starter is tidy: no input-example comment, consistent indentation, and a hint line", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/problems/view/sum");
  const labels = [
    "Python 3",
    "C++ 20",
    "C 17",
    "Java 21",
    "JavaScript",
    "TypeScript",
    "Go",
    "Rust",
  ];
  let previousValue = "";
  for (const [index, label] of labels.entries()) {
    if (index > 0) {
      await page.getByRole("combobox", { name: "언어", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }
    const editor = page.getByRole("textbox", { name: `${label} 소스 코드` });
    // 언어를 바꾼 직후에는 이름표만 먼저 바뀌고 내용은 잠깐 이전 언어일 수 있어, 내용이 바뀐 뒤에 읽는다.
    if (index > 0)
      await expect.poll(() => editor.inputValue()).not.toBe(previousValue);
    const value = await editor.inputValue();
    previousValue = value;
    expect(value, label).not.toContain("입력 예시");
    expect(value, label).toContain("여기에 코드를 작성하세요.");
    // 들여쓰기는 한 단계(JS·TS는 2칸, 나머지는 4칸)의 배수이고, 열린 블록 없이 깊어지지 않는다.
    const step = label === "JavaScript" || label === "TypeScript" ? 2 : 4;
    let previous: { indent: number; text: string } | null = null;
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      expect(indent % step, `${label}: ${JSON.stringify(line)}`).toBe(0);
      if (previous && indent > previous.indent) {
        expect(
          /[{(:]$/.test(previous.text.trimEnd()),
          `${label}: 열린 블록 없이 깊어짐 ${JSON.stringify(line)}`,
        ).toBe(true);
        expect(indent - previous.indent, label).toBeLessThanOrEqual(step);
      }
      previous = { indent, text: line };
    }
  }
});

test("the font-size and reset buttons in the editor toolbar stay visible, readable and unbroken at every width", async ({
  page,
}) => {
  await authenticate(page);
  for (const width of [320, 360, 390, 650, 651, 900, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/problems/view/sum");
    const toolbar = page.locator(".code-toolbar");
    await expect(toolbar).toBeVisible();
    const buttons = [
      page.getByRole("button", { name: "글꼴 작게" }),
      page.getByRole("button", { name: "글꼴 크게" }),
      page.getByRole("button", { name: "초기화", exact: true }),
    ];
    for (const button of buttons) {
      // 버튼으로 보이도록 테두리가 있고, 글자가 한 줄로 유지되며(높이 30px), 누르기 쉬운 크기다.
      await expect(button).toHaveCSS("border-top-width", "1px");
      await expect(button).toHaveCSS("white-space", "nowrap");
      const box = (await button.boundingBox())!;
      expect(box.height, `${width}px`).toBeGreaterThanOrEqual(30);
      expect(box.height, `${width}px`).toBeLessThanOrEqual(32);
      expect(box.width, `${width}px`).toBeGreaterThanOrEqual(34);
    }
    // 툴바가 가로로 넘치지 않고, 저장 상태 문구가 글자 하나씩 세로로 쪼개지지 않는다.
    const overflow = await toolbar.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    const saveState = (await page.locator(".save-state").boundingBox())!;
    expect(saveState.height, `${width}px`).toBeLessThan(24);
    // 글자색은 툴바 바탕과 충분히 대비된다(밝은 글자).
    const color = await buttons[0].evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(r + g + b, color).toBeGreaterThan(600);
  }

  // 글꼴 크기 한계: 최소·최대에서 해당 버튼이 비활성이 되고 숫자가 한계를 넘지 않는다.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/problems/view/sum");
  const smaller = page.getByRole("button", { name: "글꼴 작게" });
  const larger = page.getByRole("button", { name: "글꼴 크게" });
  const size = () => page.locator(".font-size").innerText();
  for (let index = 0; index < 20; index += 1) {
    if (await smaller.isDisabled()) break;
    await smaller.click();
  }
  await expect(smaller).toBeDisabled();
  await expect(smaller).toHaveCSS("opacity", "0.4");
  expect(Number(await size())).toBe(11);
  for (let index = 0; index < 20; index += 1) {
    if (await larger.isDisabled()) break;
    await larger.click();
  }
  await expect(larger).toBeDisabled();
  expect(Number(await size())).toBe(20);
});

test.describe("Tab indentation is removed one level at a time, typed spaces one at a time", () => {
  const SP4 = "    ";
  type Editor = import("@playwright/test").Locator;
  const open = async (page: import("@playwright/test").Page) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.focus();
    return editor;
  };
  // Home/End/Ctrl+End는 운영체제마다 커서를 옮기지 않는 경우가 있어(macOS), 커서 위치를 직접 지정한다.
  const caretAt = (editor: Editor, index: number) =>
    editor.evaluate((el: HTMLTextAreaElement, position: number) => {
      el.focus();
      el.setSelectionRange(position, position);
    }, index);
  const caretEnd = (editor: Editor) =>
    editor.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  const spaces = async (editor: Editor, count: number) => {
    for (let index = 0; index < count; index += 1) await editor.press("Space");
  };

  test("a Tab-made level goes with one Backspace; four typed spaces need four", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // 같은 네 칸이라도 직접 친 공백은 한 글자씩 지워진다
    await spaces(editor, 4);
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("   ");
    await editor.press("Backspace");
    await expect(editor).toHaveValue("  ");

    // Tab으로 넣은 단계 뒤에 글자를 쓰면: 글자는 한 글자, 그다음 단계는 한 번에
    await editor.fill("");
    await editor.press("Tab");
    await editor.pressSequentially("x");
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");
  });

  test("levels are separated even when spaces typed by hand sit next to them", async ({
    page,
  }) => {
    const editor = await open(page);
    // Tab 한 단계 뒤에 직접 친 공백 네 칸: 뒤의 네 칸은 한 글자씩, 그다음 Tab 단계는 한 번에
    await editor.press("Tab");
    await spaces(editor, 4);
    await expect(editor).toHaveValue(SP4 + SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4 + "   ");
    for (let index = 0; index < 3; index += 1) await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // Tab 두 번: 한 번 누를 때마다 한 단계씩
    await editor.press("Tab");
    await editor.press("Tab");
    await expect(editor).toHaveValue(SP4 + SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
  });

  test("the remembered level follows edits made before it and stays in sync with the text", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("y");
    await caretAt(editor, 0);
    await editor.pressSequentially("Q");
    await expect(editor).toHaveValue(`Q${SP4}y`);
    // 단계 바로 뒤(y 앞)에서 지우면 앞에 글자가 생겼어도 한 단계가 한 번에 지워진다
    await caretAt(editor, 5);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("Qy");

    // 단계의 가운데 글자를 지우면 더는 한 단계가 아니다: 남은 공백은 한 글자씩
    await editor.fill("");
    await editor.press("Tab");
    await caretAt(editor, 2);
    await editor.press("Delete"); // 가운데 공백 하나를 직접 지움(단위가 깨진다)
    await expect(editor).toHaveValue("   ");
    await caretEnd(editor);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("  ");
  });

  test("Delete removes a whole level that starts at the caret", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("z");
    await caretAt(editor, 0);
    await editor.press("Delete");
    await expect(editor).toHaveValue("z");
    // 직접 친 공백은 Delete도 한 글자씩
    await editor.fill("");
    await spaces(editor, 4);
    await caretAt(editor, 0);
    await editor.press("Delete");
    await expect(editor).toHaveValue("   ");
  });

  test("auto-indent after an opening bracket and carried indentation are levels too", async ({
    page,
  }) => {
    const editor = await open(page);
    // '{'를 치면 '}'가 같이 들어가므로, Enter는 닫는 괄호를 아래 줄로 내리고 안쪽 줄에 한 단계를 만든다
    await editor.pressSequentially("if (x) {");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`if (x) {\n${SP4}\n}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("if (x) {\n\n}");

    // (글자를 치면 자동완성 제안이 떠서 Enter가 제안 선택이 되므로, 제안이 뜨지 않는 숫자를 쓴다)
    // Tab으로 들여쓴 줄에서 Enter: 새 줄이 이어받은 들여쓰기도 한 단계씩 지워진다
    await editor.fill("");
    await editor.press("Tab");
    await editor.press("Tab");
    await editor.pressSequentially("1");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n${SP4}${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n`);

    // 직접 친 공백으로 들여쓴 줄에서 Enter: 이어받은 들여쓰기는 한 글자씩
    await editor.fill("");
    await spaces(editor, 4);
    await editor.pressSequentially("2");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`${SP4}2\n${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}2\n   `);
  });

  test("indenting several selected lines marks every line, and outdenting forgets them", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.fill("a\n\nb");
    await editor.press("ControlOrMeta+a");
    await editor.press("Tab");
    await expect(editor).toHaveValue(`${SP4}a\n\n${SP4}b`);
    // 마지막 줄의 한 단계(7~11번 칸) 바로 뒤에서 지운다
    await caretAt(editor, 11);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}a\n\nb`);
    // 첫 줄의 한 단계도 같다
    await caretAt(editor, 4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("a\n\nb");

    // 다시 들여쓴 뒤 Shift+Tab으로 내어쓰면 단계가 사라지고 글은 원래대로
    await editor.press("ControlOrMeta+a");
    await editor.press("Tab");
    await editor.press("ControlOrMeta+a");
    await editor.press("Shift+Tab");
    await expect(editor).toHaveValue("a\n\nb");
  });

  test("the remembered levels survive a reload together with the draft", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("q");
    await page.reload();
    const again = page.getByLabel("소스 코드");
    await expect(again).toHaveValue(`${SP4}q`);
    await caretEnd(again);
    await again.press("Backspace");
    await again.press("Backspace");
    await expect(again).toHaveValue("");

    // 직접 친 공백은 새로고침 뒤에도 한 글자씩
    await spaces(again, 4);
    await page.reload();
    const typed = page.getByLabel("소스 코드");
    await expect(typed).toHaveValue(SP4);
    await caretEnd(typed);
    await typed.press("Backspace");
    await expect(typed).toHaveValue("   ");
  });

  test("many levels, undo, pasted text and tab characters never corrupt the text", async ({
    page,
  }) => {
    const editor = await open(page);
    // 100번 Tab → 100번 Backspace로 정확히 비워진다
    for (let index = 0; index < 100; index += 1) await editor.press("Tab");
    await expect(editor).toHaveValue(SP4.repeat(100));
    for (let index = 0; index < 100; index += 1)
      await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // 실행 취소 뒤에도 글이 망가지지 않고 Backspace가 정상 동작한다
    await editor.press("Tab");
    await editor.press("Backspace");
    await editor.press("ControlOrMeta+z");
    await editor.press("Backspace");
    expect((await editor.inputValue()).trim()).toBe("");

    // 진짜 탭 문자(붙여넣기)는 한 글자로 지워진다
    await editor.fill("\t\t");
    await caretEnd(editor);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("\t");

    // 아주 긴 값 뒤에서도 기억이 어긋나지 않는다
    await editor.fill("x".repeat(50_000));
    await caretEnd(editor);
    await editor.press("Tab");
    await editor.press("Backspace");
    expect((await editor.inputValue()).length).toBe(50_000);

    // 이모지·한글·HTML 사이에서도 한 단계 단위가 지켜진다
    await editor.fill("😀한글<b>");
    await caretEnd(editor);
    await editor.press("Tab");
    await editor.pressSequentially("끝");
    await editor.press("Backspace");
    await editor.press("Backspace");
    await expect(editor).toHaveValue("😀한글<b>");
  });
});

test.describe("code editor basics on the solve page", () => {
  test("switching languages immediately keeps each language's latest draft", async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem(
        "unsolvable-oj-draft-v1:problem-id:PYTHON",
        "print(111)",
      );
      localStorage.setItem(
        "unsolvable-oj-draft-v1:problem-id:CPP",
        "int main() {}",
      );
    });
    await page.goto("/problems/view/sum");
    const python = page.getByRole("textbox", { name: "Python 3 소스 코드" });
    await expect(python).toHaveValue("print(111)");
    await python.fill("print(222)");
    await page.getByRole("combobox", { name: "언어", exact: true }).click();
    await page.getByRole("option", { name: "C++ 20", exact: true }).click();
    const cpp = page.getByRole("textbox", { name: "C++ 20 소스 코드" });
    await expect(cpp).toHaveValue("int main() {}");
    await cpp.fill("int main() { return 0; }");
    await page.getByRole("combobox", { name: "언어", exact: true }).click();
    await page.getByRole("option", { name: "Python 3", exact: true }).click();
    await expect(python).toHaveValue("print(222)");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("unsolvable-oj-draft-v1:problem-id:CPP"),
      ),
    ).toBe("int main() { return 0; }");
  });

  test("leaving the solve page immediately preserves the latest input", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto("/problems/view/sum");
    await page.getByLabel("소스 코드").fill("print(333)");
    // 풀이 화면에는 뒤로가기 링크가 없으니 머리글 메뉴의 '문제'로 목록에 돌아간다.
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "문제", exact: true })
      .click();
    // 목록의 문제는 새 탭에서 열리고, 같은 문제의 마지막 입력이 그대로 복원된다.
    await page
      .context()
      .route("**/api/v1/problems/by-slug/sum", (route) =>
        route.fulfill({ json: problem }),
      );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: new RegExp(problem.title) }).click(),
    ]);
    await expect(popup.getByLabel("소스 코드")).toHaveValue("print(333)");
  });

  test("reset removes the saved draft without restoring it on reload", async ({
    page,
  }) => {
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const starter = await editor.inputValue();
    await editor.fill("print(444)");
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    await expect(editor).toHaveValue(starter);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("unsolvable-oj-draft-v1:problem-id:PYTHON"),
      ),
    ).toBeNull();
    await page.reload();
    await expect(page.getByLabel("소스 코드")).toHaveValue(starter);
  });

  test("typing a quoted string works and Enter on a blank line adds no indentation", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.pressSequentially('"hello"');
    await expect(editor).toHaveValue('"hello"');
    await editor.fill("    ");
    await editor.press("Enter");
    await expect(editor).toHaveValue("    \n");
  });

  test("moving the caret dismisses suggestions from the previous word", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("wh\n");
    await editor.pressSequentially("fo");
    const list = page.getByRole("listbox", { name: "자동완성 제안" });
    await expect(
      list.getByRole("option", { name: /^for/ }).first(),
    ).toBeVisible();
    await editor.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(3, 3),
    );
    await editor.press("ArrowLeft");
    await expect(list).toHaveCount(0);
    await editor.press("Tab");
    await expect(editor).toHaveValue("wh    \nfo");
  });

  test("auto indent, bracket pairing, undo, comment toggle and Shift+Tab work as typed", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.focus();

    // 파이썬: ':' 뒤 Enter는 한 단계 들여쓴다
    await page.keyboard.type("def f():");
    await page.keyboard.press("Enter");
    await page.keyboard.type("print(");
    // 여는 괄호는 짝과 함께 들어가고, 닫는 괄호를 치면 건너뛴다
    await expect(editor).toHaveValue("def f():\n    print()");
    await page.keyboard.type("1)");
    await expect(editor).toHaveValue("def f():\n    print(1)");

    // 실행 취소(Ctrl/⌘+Z)가 자동 입력까지 되돌린다
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toHaveValue("def f():\n    print(1)");

    await editor.fill("a\nb");
    await editor.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(editor).toHaveValue("# a\n# b");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(editor).toHaveValue("a\nb");

    await editor.press("ControlOrMeta+a");
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("    a\n    b");
    await page.keyboard.press("Shift+Tab");
    await expect(editor).toHaveValue("a\nb");
  });

  test("autocomplete: functions, snippet placeholders, member completion and Ctrl+Space", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const list = page.getByRole("listbox", { name: "자동완성 제안" });
    await editor.fill("");
    await editor.focus();

    // 함수는 괄호까지 넣고 커서를 괄호 안에 둔다
    await page.keyboard.type("pri");
    await expect(list.getByRole("option", { name: /^print/ })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("print()");
    await page.keyboard.type("1");
    await expect(editor).toHaveValue("print(1)");
    await expect(list).toHaveCount(0);

    // Esc로 닫으면 Enter는 평소처럼 줄바꿈이다
    await editor.fill("");
    await page.keyboard.type("whi");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    // 스니펫: 칸을 고른 채 시작하고 Tab으로 다음 칸으로 간다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("for");
    await expect(
      list.getByRole("option", { name: /^for/ }).first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue("for i in range(n):\n    ");
    await page.keyboard.type("k");
    await expect(editor).toHaveValue("for k in range(n):\n    ");
    await page.keyboard.press("Tab");
    await page.keyboard.type("5");
    await expect(editor).toHaveValue("for k in range(5):\n    ");
    await page.keyboard.press("Tab");
    await page.keyboard.type("x");
    await expect(editor).toHaveValue("for k in range(5):\n    x");

    // 멤버 완성: 변수 타입을 짐작해 그 타입의 메서드만 보여 준다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("s = input()");
    await page.keyboard.press("Enter");
    await page.keyboard.type("s.sp");
    await expect(list.getByRole("option").first()).toContainText("split");
    await expect(list.getByRole("option", { name: /append/ })).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("s = input()\ns.split()");

    // 문자열 안에서는 제안하지 않는다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type('x = "pri');
    await expect(list).toHaveCount(0);

    // Ctrl+Space로 직접 부른다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.press("Control+Space");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    // ↑↓로 고른다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("pr");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const picked = await list
      .getByRole("option", { selected: true })
      .locator(".suggestion-label")
      .innerText();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue(new RegExp(`^${picked}`));
  });

  test("font size changes the editor and is remembered; the cursor position is shown", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const size = () => editor.evaluate((el) => getComputedStyle(el).fontSize);
    expect(await size()).toBe("13px");
    await page.getByRole("button", { name: "글꼴 크게" }).click();
    await page.getByRole("button", { name: "글꼴 크게" }).click();
    expect(await size()).toBe("15px");
    await page.reload();
    expect(await size()).toBe("15px");
    await page.getByRole("button", { name: "글꼴 작게" }).click();
    expect(await size()).toBe("14px");

    await editor.fill("ab\ncde");
    await expect(page.getByText("줄 2, 열 4")).toBeVisible();
  });
});

test.describe("solve page: resizable statement | code split", () => {
  const SPLIT_KEY = "unsolvable-oj-solve-split-v1";
  type Page = import("@playwright/test").Page;
  const open = async (page: Page, stored?: string) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticate(page);
    if (stored !== undefined)
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [SPLIT_KEY, stored],
      );
    await page.goto("/problems/view/sum");
    await expect(page.locator(".solve-grid")).toBeVisible();
  };
  const widths = (page: Page) =>
    page.evaluate(() => {
      const width = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector)!;
        return el.offsetParent === null
          ? 0
          : Math.round(el.getBoundingClientRect().width);
      };
      return {
        statement: width(".statement-panel"),
        code: width(".code-panel"),
        grid: width(".solve-grid"),
      };
    });
  const handle = (page: Page) =>
    page.getByRole("separator", { name: "문제 설명과 코드 작성 크기 조절" });
  const dragTo = async (page: Page, x: number) => {
    const box = (await handle(page).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };

  test("dragging the handle resizes both panels, and a reload starts from the default again", async ({
    page,
  }) => {
    await open(page);
    const before = await widths(page);
    await dragTo(page, 800);
    const after = await widths(page);
    expect(after.statement).toBeGreaterThan(before.statement + 100);
    expect(after.code).toBeLessThan(before.code - 100);
    await page.reload();
    await expect(page.getByLabel("소스 코드")).toBeVisible();
    expect(
      Math.abs((await widths(page)).statement - before.statement),
    ).toBeLessThan(3);
    // 아무것도 저장하지 않는다
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), SPLIT_KEY),
    ).toBeNull();
  });

  test("just before a panel vanishes it stops at its minimum width; only a further drag removes it", async ({
    page,
  }) => {
    await open(page);
    // 격자는 페이지 왼쪽에서 24px, 손잡이 중심은 문제 설명 폭 + 8px 지점
    await dragTo(page, 24 + 260 + 8); // 최소 폭에 딱 맞는 위치
    const atMin = (await widths(page)).statement;
    expect(atMin).toBeGreaterThanOrEqual(255);
    expect(atMin).toBeLessThanOrEqual(265);
    await dragTo(page, 24 + 260 + 8 - 50); // 여유 구간 안: 최소 폭에서 멈춘다
    expect(Math.abs((await widths(page)).statement - atMin)).toBeLessThan(3);
    await dragTo(page, 24 + 260 + 8 - 100); // 여유 구간을 넘으면 사라진다
    expect((await widths(page)).statement).toBe(0);

    // 코드 작성 쪽도 같다(격자 폭 1392, 손잡이 16, 코드 최소 380)
    await dragTo(page, 700);
    const codeEdge = 24 + (1392 - 16 - 380) + 8;
    await dragTo(page, codeEdge + 30);
    const codeAtMin = (await widths(page)).code;
    expect(codeAtMin).toBeGreaterThanOrEqual(375);
    expect(codeAtMin).toBeLessThanOrEqual(385);
    await dragTo(page, codeEdge + 60);
    expect(Math.abs((await widths(page)).code - codeAtMin)).toBeLessThan(3);
    await dragTo(page, codeEdge + 110);
    expect((await widths(page)).code).toBe(0);
  });

  test("dragging far left hides the statement, far right hides the code, and typed code survives both", async ({
    page,
  }) => {
    await open(page);
    const editor = page.getByLabel("소스 코드");
    await editor.fill("12345");
    await dragTo(page, 2);
    let now = await widths(page);
    expect(now.statement).toBe(0);
    expect(now.code).toBeGreaterThan(1300);
    await expect(editor).toHaveValue("12345");

    await dragTo(page, 700);
    now = await widths(page);
    expect(now.statement).toBeGreaterThan(200);
    await dragTo(page, 1438);
    now = await widths(page);
    expect(now.code).toBe(0);
    expect(now.statement).toBeGreaterThan(1300);
    await dragTo(page, 700);
    await expect(editor).toHaveValue("12345");
    expect((await widths(page)).code).toBeGreaterThan(300);
  });

  test("keyboard: arrows, Home/End and Enter; double-click resets", async ({
    page,
  }) => {
    await open(page);
    const start = (await widths(page)).statement;
    await handle(page).focus();
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(start);
    await page.keyboard.press("Home");
    expect((await widths(page)).statement).toBe(0);
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(200);
    await page.keyboard.press("End");
    expect((await widths(page)).code).toBe(0);
    await page.keyboard.press("ArrowLeft");
    expect((await widths(page)).code).toBeGreaterThan(300);
    await page.keyboard.press("Home");
    await handle(page).dblclick();
    expect(Math.abs((await widths(page)).statement - start)).toBeLessThan(3);
    await page.keyboard.press("Escape");
    await page.keyboard.press("a");
    expect(Math.abs((await widths(page)).statement - start)).toBeLessThan(3);
  });

  test("hidden panel is not focusable or visible", async ({ page }) => {
    await open(page);
    await dragTo(page, 2);
    await expect(page.locator(".statement-panel")).toBeHidden();
    await dragTo(page, 1438);
    await expect(page.locator(".code-panel")).toBeHidden();
    await expect(page.getByLabel("소스 코드")).toBeHidden();
  });

  test("old or odd saved values are ignored: the page always opens at the default", async ({
    page,
  }) => {
    await open(page);
    const base = await widths(page);
    for (const bad of [
      JSON.stringify({ ratio: 0.7, collapsed: "statement" }),
      JSON.stringify({ ratio: 0.2, collapsed: "code" }),
      "not json",
      '{"ratio":1e999}',
      "<script>alert(1)</script>",
      "😀".repeat(2000),
    ]) {
      await open(page, bad);
      const now = await widths(page);
      expect(Math.abs(now.statement - base.statement)).toBeLessThan(3);
      expect(Math.abs(now.code - base.code)).toBeLessThan(3);
    }
  });

  test("a narrower window hides a panel that no longer fits", async ({
    page,
  }) => {
    await open(page);
    await dragTo(page, 1058); // 코드 작성을 최소 폭(380)까지 줄인다
    expect((await widths(page)).code).toBeGreaterThan(370);
    await page.setViewportSize({ width: 1110, height: 900 });
    await expect.poll(async () => (await widths(page)).code).toBe(0);
  });

  // 실제 서버처럼 문제마다 id가 다르게 내려오도록 한다
  const distinctProblems = (page: Page) =>
    page.route("**/api/v1/problems/by-slug/*", async (route) => {
      const slug = new URL(route.request().url()).pathname.split("/").at(-1)!;
      await route.fulfill({
        json: { ...problem, id: `id-${slug}`, slug, title: `문제 ${slug}` },
      });
    });
  const goInApp = (page: Page, path: string) =>
    page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);

  test("moving to another problem starts again from the default size", async ({
    page,
  }) => {
    await distinctProblems(page);
    await open(page);
    const base = await widths(page);
    await dragTo(page, 1438); // 코드 작성을 숨긴다
    expect((await widths(page)).code).toBe(0);
    await goInApp(page, "/problems/view/other");
    await expect(
      page.getByRole("heading", { name: "문제 other" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        Math.abs((await widths(page)).statement - base.statement),
      )
      .toBeLessThan(3);
    expect((await widths(page)).code).toBeGreaterThan(300);
  });

  test("leaving the problem in the middle of a drag leaves no stuck drag state", async ({
    page,
  }) => {
    await distinctProblems(page);
    await open(page);
    const box = (await handle(page).boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40, { steps: 4 });
    await goInApp(page, "/problems/view/other");
    await expect(
      page.getByRole("heading", { name: "문제 other" }),
    ).toBeVisible();
    await page.mouse.up();
    await expect(page.locator(".solve-grid")).not.toHaveClass(/is-dragging/);
    // 코드 입력창이 다시 눌리고 입력된다
    const editor = page.getByLabel("소스 코드");
    await editor.click();
    await editor.fill("12345");
    await expect(editor).toHaveValue("12345");
  });

  test("grabbing the handle focuses it, so the arrow keys work right after a drag", async ({
    page,
  }) => {
    await open(page);
    await page.getByLabel("소스 코드").click();
    await dragTo(page, 700);
    await expect(handle(page)).toBeFocused();
    const before = (await widths(page)).statement;
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(before);
  });

  test("releasing the pointer outside the grid still ends the drag", async ({
    page,
  }) => {
    await open(page);
    await dragTo(page, 800);
    await page.mouse.move(100, 400);
    const stable = await widths(page);
    await page.mouse.move(1000, 400);
    expect(await widths(page)).toEqual(stable);
  });
});
