// 빌드 결과물(dist)에 코드 분석 정답 해설이 들어가지 않았는지 확인한다. `vite build` 뒤에 실행한다.
// 문항 원본은 서버(Back)에만 있고, 브라우저는 답을 확인한 뒤에만 정답·해설을 받는다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { analysisCatalog } = await import(
  "../../Back/src/modules/missions/analysis-catalog.ts"
);
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const bundle = readdirSync(dist, { recursive: true })
  .filter((file) => /\.(js|mjs|html|css|json|map)$/.test(file))
  .map((file) => readFileSync(join(dist, file), "utf8"))
  .join("\n")
  // 번들러가 한글을 \uXXXX로, 따옴표를 \"로 바꿔 넣어도 찾을 수 있게 되돌린다.
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
  .replace(/\\(["'`\\])/g, "$1");

// 검사가 실제 번들 문구를 읽고 있는지 확인한다(화면 문구는 있어야 한다).
assert.ok(bundle.includes("정답 확인"), "dist에서 화면 문구를 찾지 못했습니다. 먼저 빌드하세요.");
const leaked = analysisCatalog
  .flatMap((question) => question.explanation)
  .filter((paragraph) => bundle.includes(paragraph));
assert.deepEqual(leaked, [], "코드 분석 해설이 Front 번들에 들어 있습니다.");
console.log(
  `코드 분석 해설 ${analysisCatalog.length}문항이 번들에 없습니다.`,
);
