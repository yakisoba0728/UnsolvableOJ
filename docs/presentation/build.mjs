// src/의 덱을 CSS·스크립트·이미지·영상·글꼴까지 data URI로 넣은 HTML 한 파일로 묶는다.
// 사용: node docs/presentation/build.mjs  →  docs/presentation/못풀준_중간발표.html
// index.html의 <!-- @scene 이름 --> 자리에는 src/scenes/이름/의 scene.html을 넣고, scene.css·scene.js도 함께 묶는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "src");
const out = join(here, "못풀준_중간발표.html");
const types = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".json": "application/json",
};

const draft = process.argv.includes("--draft");
const dataUri = (path) => {
  if (draft && !existsSync(path)) return "data:,"; // --draft: 아직 없는 영상·이미지는 비워 둔다
  const type = types[extname(path).toLowerCase()];
  if (!type) throw new Error(`알 수 없는 파일 형식: ${path}`);
  return `data:${type};base64,${readFileSync(path).toString("base64")}`;
};
// CSS 안의 상대 url()은 그 CSS 파일 위치를 기준으로 푼다.
const inlineCss = (path) =>
  readFileSync(path, "utf8").replace(/url\(\s*["']?(?!data:|https?:|#)([^"')]+)["']?\s*\)/g, (_, ref) => `url("${dataUri(join(dirname(path), ref))}")`);
const inlineJs = (path) => readFileSync(path, "utf8").replaceAll("</script", "<\\/script");

// 장면은 각자 폴더의 파일을 기준으로 상대 경로를 쓰므로, 덱(src/) 기준 경로로 바꿔 넣는다.
const sceneStyles = [];
const sceneScripts = [];
let html = readFileSync(join(src, "index.html"), "utf8").replace(/<!-- @scene ([a-z0-9-]+) -->/g, (_, id) => {
  const dir = join(src, "scenes", id);
  if (!existsSync(join(dir, "scene.html"))) {
    // --draft: 아직 없는 장면 자리를 표시만 하고 계속 묶는다(최종 빌드에서는 멈춘다).
    if (!draft) throw new Error(`장면이 없습니다: scenes/${id}/scene.html`);
    return `<section class="slide" data-title="${id}"><h2 class="hl">장면 준비 중: ${id}</h2><div class="deck-footer"><span class="slide-number"></span></div></section>`;
  }
  for (const [file, list] of [["scene.css", sceneStyles], ["scene.js", sceneScripts]])
    if (existsSync(join(dir, file))) list.push(join(dir, file));
  return readFileSync(join(dir, "scene.html"), "utf8").replace(/(\s(?:src|poster)=")(?!data:|https?:|#)([^"]+)"/g, (_, head, ref) => `${head}${join("scenes", id, ref)}"`);
});

// 쪽 번호는 묶은 순서대로 매긴다(장면을 끼워 넣어도 번호가 맞게).
const total = (html.match(/<section class="slide[\s"]/g) || []).length;
let page = 0;
html = html.replace(/<section class="slide[\s"]|<span class="slide-number"[^>]*><\/span>/g, (tag) =>
  tag.startsWith("<section") ? (page++, tag) : `<span class="slide-number" data-current="${page}" data-total="${total}"></span>`);

// 이미지·영상을 먼저 바꾸고 남은 로컬 참조를 검사한 뒤에 CSS·스크립트를 넣는다(런타임 코드 속 문자열은 건드리지 않게).
// 한 번에 태그마다 속성 하나씩 바뀌므로, poster와 src가 함께 있는 <video>를 위해 두 번 돈다.
const media = /(<(?:img|video|source)[^>]*\s(?:src|poster)=")(?!data:|https?:)([^"]+)"/g;
for (let pass = 0; pass < 2; pass++) html = html.replace(media, (_, head, file) => `${head}${dataUri(join(src, file))}"`);
html = html.replace(/<script type="application\/json" data-src="([^"]+)"><\/script>/g, (_, file) => `<script type="application/json">${draft && !existsSync(join(src, file)) ? "{}" : readFileSync(join(src, file), "utf8").trim()}</script>`);
const links = /<link rel="stylesheet"((?: id="[^"]+")?) href="([^"]+)">/g;
const scripts = /<script src="([^"]+)"><\/script>/g;
const leftovers = html.replace(links, "").replace(scripts, "").match(/(?:src|href|poster)="(?!data:|https?:|#)[^"]+"/g);
if (leftovers) throw new Error(`묶이지 않은 로컬 참조: ${leftovers.join(", ")}`);
html = html.replace(links, (_, id, href) => `<style${id}>\n${inlineCss(join(src, href))}\n</style>`);
html = html.replace(scripts, (_, file) => `<script>\n${inlineJs(join(src, file))}\n</script>`);
html = html.replace("</head>", `${sceneStyles.map((path) => `<style>\n${inlineCss(path)}\n</style>\n`).join("")}</head>`);
// 런타임 코드 안에도 발표자 창용 "</body>" 문자열이 있어, 문서의 진짜 끝(마지막 </body>) 앞에 넣는다.
const bodyEnd = html.lastIndexOf("</body>");
html = html.slice(0, bodyEnd) + sceneScripts.map((path) => `<script>\n${inlineJs(path)}\n</script>\n`).join("") + html.slice(bodyEnd);
writeFileSync(out, html);
console.log(`${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)}MB)`);
