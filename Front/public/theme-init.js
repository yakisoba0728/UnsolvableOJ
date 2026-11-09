// 첫 화면이 그려지기 전에 테마를 적용해 라이트→다크 깜빡임을 막는다 (src/theme.ts와 같은 규칙).
// CSP가 인라인 스크립트를 막으므로 index.html 안이 아니라 이 파일로 둔다.
(function () {
  try {
    var t = localStorage.getItem("unsolvable-oj-theme-v1");
    if (t !== "light" && t !== "dark")
      t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute("content", t === "dark" ? "#171d27" : "#fbfcfe");
  } catch (e) {}
})();
