/* 장면: 격리 실행. 화면은 시각 t(ms)만으로 정해지는 render(t)로 그린다.
 * 장이 보이면(.is-active) 처음부터 재생하고, 벗어나면 멈추고 마지막 정리 화면으로 되돌린다. */
(function () {
  "use strict";
  var root = document.getElementById("scene-sandbox");
  if (!root) return;
  var q = function (s) { return root.querySelector(s); };
  var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

  // 한 사례의 흐름(사례 시작 기준 ms): 카드 등장 → 방에 들어감 → 계기판 상승 → 제한 도달 → 카드 퇴장
  var CASE = 2700, RUN = 600, CLIMB = 750, HIT = 1750, EXIT = 2400;
  var T0 = 200, END = T0 + 5 * CASE, OUT = END + 3500, CYCLE = OUT + 500;

  var CASES = [
    { file: "main.py", lang: "Python", title: "끝나지 않는 반복문", lbl: "판정", pill: "시간 초과", sub: "TIME_LIMIT_EXCEEDED", stop: "1초에서 강제 종료",
      code: '<span class="k">while</span> <span class="k">True</span>:\n    <span class="k">pass</span>' },
    { file: "main.py", lang: "Python", title: "메모리를 끝없이 차지하기", lbl: "판정", pill: "메모리 초과", sub: "MEMORY_LIMIT_EXCEEDED", stop: "256MB에서 강제 종료",
      code: 'data = []\n<span class="k">while</span> <span class="k">True</span>:\n    data.append([0] * 10**6)' },
    { file: "main.c", lang: "C", title: "끝없이 출력하기", lbl: "판정", pill: "출력 초과", sub: "OUTPUT_LIMIT_EXCEEDED", stop: "1,000,000바이트에서 차단",
      code: '<span class="k">#include</span> &lt;stdio.h&gt;\n<span class="k">int</span> main(<span class="k">void</span>) {\n    <span class="k">while</span> (1) puts(<span class="s">"hello"</span>);\n}' },
    { file: "main.c", lang: "C", title: "자기 자신을 계속 복제하기", lbl: "결과", pill: "프로세스 64개에서 막힘", sub: "65번째부터는 만들어지지 않습니다", stop: "64개에서 복제 차단", soft: true,
      code: '<span class="k">#include</span> &lt;unistd.h&gt;\n<span class="k">int</span> main(<span class="k">void</span>) {\n    <span class="k">while</span> (1) fork();\n}' },
    { file: "main.py", lang: "Python", title: "인터넷에 몰래 접속하기", lbl: "결과", pill: "연결 안 됨", sub: "방 밖으로 나가는 길이 없습니다", stop: "바깥 연결 실패", soft: true,
      code: '<span class="k">import</span> socket\ns = socket.socket()\ns.connect((<span class="s">"example.com"</span>, 80))' },
  ];

  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var seg = function (t, a, d) { return clamp((t - a) / d); };
  var out = function (p) { return 1 - Math.pow(1 - p, 3); };
  var back = function (p) { var c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };

  // 같은 값을 매 프레임 다시 쓰지 않도록 마지막 값을 기억한다.
  function set(el, key, val) {
    var memo = el.__sb || (el.__sb = {});
    if (memo[key] === val) return;
    memo[key] = val;
    if (key === "text") el.textContent = val;
    else if (key === "html") el.innerHTML = val;
    else if (key.charAt(0) === "@") el.setAttribute(key.slice(1), val);
    else if (key.charAt(0) === ".") el.classList.toggle(key.slice(1), val);
    else el.style[key] = val;
  }

  var stepsN = q(".sb-steps-n"), dots = qa(".sb-dots i"), steps = q(".sb-steps");
  var card = q(".sb-card"), cFile = q(".sb-file"), cLang = q(".sb-lang"), cTitle = q(".sb-card-title"), cCode = q(".sb-code");
  var vLbl = q(".sb-v-lbl"), vWait = q(".sb-v-wait"), vOut = q(".sb-v-out"), vPill = q(".sb-v-pill"), vEnum = q(".sb-v-enum");
  var room = q(".sb-room"), status = q(".sb-status"), statusText = q(".sb-status b");
  var tiles = qa(".sb-tile"), vals = tiles.map(function (t) { return t.querySelector(".sb-val"); });
  var bars = tiles.map(function (t) { return t.querySelector(".sb-bar i"); });
  var hits = tiles.map(function (t) { return t.querySelector(".sb-hit"); });
  var cellBox = q(".sb-cells"), cells = [];
  for (var i = 0; i < 64; i++) cells.push(cellBox.appendChild(document.createElement("i")));
  var wires = q(".sb-wires"), feed = q(".sb-feed"), feedDot = q(".sb-feed-dot"), trail = q(".sb-trail"), packet = q(".sb-packet"), block = q(".sb-block");
  var sum = Array.prototype.slice.call(q(".sb-sum").children);

  var procs = function (p) { return p <= 0 ? 0 : Math.pow(2, Math.floor(p * 6)); }; // 1 → 2 → 4 … → 64
  function reading(k, p) {
    if (k === 0) return p.toFixed(2) + "초";
    if (k === 1) return Math.round(32 * p) * 8 + "MB"; // 한 번에 8MB(정수 100만 개 목록)씩 늘어난다
    if (k === 2) return Math.round(1e6 * p).toLocaleString("en-US") + "바이트";
    return procs(p) + "개";
  }

  function render(t) {
    var c = t < T0 ? -1 : t < END ? Math.floor((t - T0) / CASE) : 5; // 지금 사례(5 = 마무리)
    var lt = c >= 0 && c < 5 ? t - T0 - c * CASE : 0;
    var r = t >= OUT ? (t - OUT) / (CYCLE - OUT) : 0; // 마지막 되감기 0 → 1
    var zero = r >= 0.5; // 되감기 후반부터는 빈 처음 화면
    var fade = r ? (zero ? (r - 0.5) * 2 : 1 - r * 2) : 1;
    var k, kt, p, hit;

    // 몇 번째 예시인지
    set(stepsN, "text", Math.max(1, Math.min(5, c + 1)) + " / 5");
    dots.forEach(function (d, j) { set(d, ".is-done", c > j && c < 5); set(d, ".is-now", c === j); });
    var lead = String(c === 5 && !zero ? 1 - seg(t, END, 300) : zero ? fade : 1);
    set(steps, "opacity", lead);
    set(feed, "opacity", lead);

    // 제출 코드 카드
    if (c >= 0 && c < 5) {
      var cs = CASES[c];
      set(cFile, "text", cs.file); set(cLang, "text", cs.lang); set(cTitle, "text", cs.title); set(cCode, "html", cs.code);
      set(vLbl, "text", cs.lbl); set(vPill, "text", cs.pill); set(vEnum, "text", cs.sub); set(card, ".is-soft", !!cs.soft);
      var cin = out(seg(lt, 0, 450)), cout = seg(lt, EXIT, 250);
      set(card, "opacity", String(cin * (1 - cout)));
      set(card, "transform", "translateY(" + ((1 - cin) * 24 - cout * 14).toFixed(1) + "px)");
      set(vWait, "text", lt < RUN ? "방에 넣는 중…" : "실행 중…");
      set(vWait, "opacity", String(1 - seg(lt, HIT, 120)));
      set(vOut, "opacity", String(seg(lt, HIT + 50, 200)));
      set(vPill, "transform", "scale(" + (0.86 + 0.14 * back(seg(lt, HIT + 50, 320))).toFixed(3) + ")");
      set(vEnum, "opacity", String(seg(lt, HIT + 150, 250)));
      // 코드가 방으로 들어가는 점과 방 테두리의 반짝임
      var f = seg(lt, 380, 340);
      set(feedDot, "@cx", (494 + 56 * out(f)).toFixed(1));
      set(feedDot, "opacity", String(f > 0 && f < 1 ? 1 : 0));
      var g = seg(lt, 650, 520);
      set(room, "boxShadow", g > 0 && g < 1 ? "0 0 0 " + (16 * out(g)).toFixed(1) + "px rgba(29, 79, 216, " + (0.26 * (1 - g)).toFixed(3) + ")" : "none");
    } else {
      set(card, "opacity", "0"); set(feedDot, "opacity", "0"); set(room, "boxShadow", "none");
    }

    // 방 위쪽 상태
    var st = "", label = "대기 중";
    if (zero || c === -1) st = "";
    else if (c === 5) { st = "is-ok"; label = "다섯 가지 모두 방 안에서 막힘"; }
    else if (lt >= HIT) { st = CASES[c].soft ? "is-block" : "is-stop"; label = CASES[c].stop; }
    else if (lt >= RUN) { st = "is-run"; label = CASES[c].file + " 실행 중"; }
    ["is-run", "is-stop", "is-block", "is-ok"].forEach(function (n) { set(status, "." + n, st === n); });
    set(statusText, "text", label);

    // 계기판 다섯 칸
    for (k = 0; k < 5; k++) {
      kt = t - T0 - k * CASE;
      p = zero ? 0 : seg(kt, CLIMB, HIT - CLIMB);
      hit = !zero && kt >= HIT;
      set(tiles[k], ".is-on", c === k && lt >= 300);
      set(tiles[k], ".is-dim", c >= 0 && c < 5 && c !== k);
      set(tiles[k], ".is-hit", hit);
      if (vals[k]) { set(vals[k], "text", reading(k, p)); set(vals[k], "opacity", String(r ? fade : 1)); }
      if (bars[k]) set(bars[k], "transform", "scaleX(" + ((k === 1 ? Math.round(32 * p) / 32 : p) * (r && !zero ? fade : 1)).toFixed(4) + ")");
      var pop = hit ? seg(kt, HIT + 100, 320) : 0;
      set(hits[k], "opacity", String(pop * (r ? fade : 1)));
      set(hits[k], "transform", "scale(" + (0.85 + 0.15 * back(pop)).toFixed(3) + ")");
    }
    var n = procs(zero ? 0 : seg(t - T0 - 3 * CASE, CLIMB, HIT - CLIMB));
    cells.forEach(function (cell, j) { set(cell, ".on", j < n); });
    set(cellBox, "opacity", String(r && !zero ? fade : 1));

    // 네트워크: 바깥으로 나가려던 신호가 방 벽에서 끊긴다
    kt = t - T0 - 4 * CASE;
    p = zero ? 0 : seg(kt, CLIMB, HIT - CLIMB);
    hit = !zero && kt >= HIT;
    var x = 616 + 928 * p * p; // 가속하다가 벽 바로 앞에서 멈춘다
    set(trail, "@x2", x.toFixed(1));
    set(trail, "opacity", String(r ? fade : 1));
    set(packet, "@cx", (x - (hit ? 12 * Math.sin(seg(kt, HIT, 240) * Math.PI) : 0)).toFixed(1));
    set(packet, "opacity", String(p > 0 && !zero ? 1 - seg(kt, HIT + 80, 200) : 0));
    set(wires, ".is-net-hit", hit);
    var b = hit ? seg(kt, HIT, 320) : 0;
    set(block, "opacity", String(b * (r ? fade : 1)));
    set(block, "@transform", "translate(1564 706) scale(" + (0.6 + 0.4 * back(b)).toFixed(3) + ")");

    // 마무리: 이전과 지금
    [0, 150, 250, 450].forEach(function (d, j) {
      var e = c === 5 && !zero ? out(seg(t, END + d, 500)) : 0;
      set(sum[j], "opacity", String(e * (r && !zero ? fade : 1)));
      set(sum[j], "transform", "translateY(" + (18 * (1 - e)).toFixed(1) + "px)");
    });
  }

  // 장면을 순간 이동할 때(시작 · 멈춤)는 CSS 전환 없이 바로 그린다.
  var stage = q(".sb-stage");
  function jump(t) { stage.classList.add("is-jump"); render(t); void stage.offsetWidth; stage.classList.remove("is-jump"); }
  var STILL = END + 1500; // 멈춰 있을 때 보이는 장면: 마지막 정리 화면(전체 보기 · 인쇄 · 장면 전환 중에도 이 화면)

  var raf = 0, start = 0, playing = false;
  function frame() {
    render((performance.now() - start) % CYCLE);
    raf = requestAnimationFrame(frame);
  }
  function play() {
    playing = true;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      jump(STILL); // 움직임 없이 마지막 장면만
      return;
    }
    start = performance.now();
    jump(0);
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    jump(STILL);
  }
  function sync() {
    var active = root.classList.contains("is-active");
    if (active && !playing) play();
    else if (!active && playing) stop();
  }
  jump(STILL);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class"] });
  sync();
})();
