/* 장면: 채점 복구. 화면은 시각 t(ms)만으로 정해지는 render(t)로 그린다.
 * 실제 시간(초)은 SIM 표로 압축한다: 예약 60초 · 연장 10초 · 순찰 30초 간격은 그대로 지킨다.
 * 장이 보이면(.is-active) 처음부터 재생하고, 벗어나면 멈추고 마지막 정리 화면으로 되돌린다. */
(function () {
  "use strict";
  var root = document.getElementById("scene-recovery");
  if (!root) return;
  var q = function (s) { return root.querySelector(s); };
  var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

  // 화면 시각(ms) → 실제로 흐른 시간(초)
  var SIM = [[0, 0], [1200, 0], [2800, 25], [5600, 90], [7400, 91], [8000, 94], [9600, 98]];
  function sim(t) {
    for (var i = 1; i < SIM.length; i++) {
      if (t <= SIM[i][0]) {
        var a = SIM[i - 1], b = SIM[i];
        return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
      }
    }
    return SIM[SIM.length - 1][1];
  }
  function at(s) { // 실제 s초가 되는 화면 시각
    for (var i = 1; i < SIM.length; i++) {
      var a = SIM[i - 1], b = SIM[i];
      if (s <= b[1] && b[1] > a[1]) return a[0] + (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]);
    }
    return SIM[SIM.length - 1][0];
  }

  var CLAIM_A = 400, GOT_A = 850;            // 워커 A가 가져감(실제 0초, 예약 60초)
  var HB = [at(10), at(20)];                 // 10초마다 예약 연장
  var STALL = at(25);                        // 워커 A가 멈춤 → 연장이 끊김
  var PATROL = [at(30), at(60), at(90)];     // 30초마다 복구 순찰
  var EXPIRE = at(80);                       // 마지막 연장(20초) + 60초
  var FLIP = PATROL[2] + 150, BACK = FLIP + 250; // 세대 2로 바꿔 다시 줄에
  var CLAIM_B = 6700, GOT_B = 7200;          // 워커 B가 새 시도로 가져감
  var RES_B = 8000, SAVE = 8550;             // B의 결과를 서버가 저장
  var LATE = 9000, RES_A = 9250, REJECT = 9700; // A가 늦게 보낸 세대 1 결과 거절
  var XP = 10300, OUT = 13500, CYCLE = 14000;

  var Q = [30, 156], A = [474, 140], B = [474, 420]; // 카드 자리(왼쪽 위)

  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var seg = function (t, a, d) { return clamp((t - a) / d); };
  var out = function (p) { return 1 - Math.pow(1 - p, 3); };
  var inOut = function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  var lerp = function (a, b, p) { return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p]; };

  function set(el, key, val) {
    var memo = el.__rc || (el.__rc = {});
    if (memo[key] === val) return;
    memo[key] = val;
    if (key === "text") el.textContent = val;
    else if (key.charAt(0) === "@") el.setAttribute(key.slice(1), val);
    else if (key.charAt(0) === ".") el.classList.toggle(key.slice(1), val);
    else el.style[key] = val;
  }

  var clock = q(".rc-clock");
  var card = q(".rc-card"), gen = q(".rc-gen"), st = q(".rc-st"), en = q(".rc-enum");
  var wa = q(".rc-wa"), wb = q(".rc-wb");
  var chipA = wa.querySelector(".rc-chip"), chipB = wb.querySelector(".rc-chip");
  var capA = wa.querySelector(".rc-cap"), capB = wb.querySelector(".rc-cap");
  var capAText = capA.querySelector("span");
  var ringA = q(".rc-ring-a"), ringB = q(".rc-ring-b");
  var patrolIco = q(".rc-patrol-ico"), logs = qa(".rc-log li");
  var nowVal = q(".rc-now-val"), empty = q(".rc-empty"), rowOk = q(".rc-row.is-ok"), rowNo = q(".rc-row.is-no");
  var back = q(".rc-edge-back"), envA = q(".rc-env-a"), envB = q(".rc-env-b"), xp = q(".rc-xp");

  function ring(g, t, rem, show, scanAt, pulseAt) {
    set(g, "opacity", String(show));
    set(g.querySelector(".rc-arc"), "@stroke-dashoffset", (314.16 * (1 - rem / 60)).toFixed(2));
    set(g, ".is-expired", rem <= 0);
    set(g.querySelector(".rc-sec"), "text", rem <= 0 ? "만료" : Math.ceil(rem) + "초");
    set(g.querySelector(".rc-left"), "opacity", rem <= 0 ? "0" : "1");
    // 연장(heartbeat): 바깥으로 퍼지는 고리
    var pr = 0, po = 0;
    pulseAt.forEach(function (h) { var e = seg(t, h, 650); if (e > 0 && e < 1) { pr = 22 * out(e); po = 0.6 * (1 - e); } });
    var pulse = g.querySelector(".rc-pulse");
    set(pulse, "@r", (50 + pr).toFixed(1)); set(pulse, "opacity", po.toFixed(3));
    // 순찰: 점선 고리가 한 바퀴 훑는다
    var so = 0, rot = 0, found = false;
    scanAt.forEach(function (p, i) {
      var e = seg(t, p, 800);
      if (e > 0 && e < 1) { so = e < 0.15 ? e / 0.15 : 1 - (e - 0.15) / 0.85; rot = 140 * out(e); found = i === 2; }
    });
    var scan = g.querySelector(".rc-scan");
    set(scan, "opacity", so.toFixed(3)); set(scan, "@transform", "rotate(" + rot.toFixed(1) + ")");
    set(g, ".is-found", found);
  }

  function render(t) {
    var r = t >= OUT ? (t - OUT) / (CYCLE - OUT) : 0; // 마지막 되감기 0 → 1
    var zero = r >= 0.5;
    var fade = r ? (zero ? (r - 0.5) * 2 : 1 - r * 2) : 1;
    var tt = zero ? 0 : t; // 되감기 후반부터는 처음 화면
    var s = sim(tt), m = Math.floor(s / 60), sec = Math.floor(s % 60);
    set(clock, "text", m + ":" + (sec < 10 ? "0" : "") + sec);
    set(clock, "opacity", String(fade));

    // 제출 카드: 줄 → 워커 A → (복구) 줄 → 워커 B
    var pos = tt < BACK ? lerp(Q, A, inOut(seg(tt, CLAIM_A, 450)))
      : tt < CLAIM_B ? lerp(A, Q, inOut(seg(tt, BACK, 500)))
      : lerp(Q, B, inOut(seg(tt, CLAIM_B, 500)));
    set(card, "transform", "translate(" + pos[0].toFixed(1) + "px, " + pos[1].toFixed(1) + "px)");
    set(card, "opacity", String(fade));
    var phase = tt >= SAVE ? 3 : tt >= GOT_B ? 2 : tt >= FLIP ? 1 : tt >= GOT_A ? 2 : 1; // 1 대기 · 2 채점 중 · 3 정답
    set(card, ".is-run", phase === 2); set(card, ".is-done", phase === 3);
    set(st, "text", ["", "대기", "채점 중", "정답"][phase]);
    set(en, "text", ["", "QUEUED", "JUDGING", "ACCEPTED"][phase]);
    set(gen, "text", tt >= FLIP ? "세대 2" : "세대 1");
    var g = seg(tt, FLIP - 100, 500);
    set(gen, ".is-flash", g > 0 && g < 1);
    set(gen, "transform", "scale(" + (1 + 0.22 * Math.sin(g * Math.PI)).toFixed(3) + ")");

    // 워커 A: 채점 중 → 멈춤 → 늦게 결과 전송
    set(wa, ".is-run", tt >= GOT_A && tt < STALL);
    set(wa, ".is-stall", tt >= STALL);
    set(wa, ".is-late", tt >= LATE);
    set(chipA, "text", tt >= REJECT ? "결과 거절됨" : tt >= LATE ? "늦은 결과 보냄" : tt >= STALL ? "응답 없음 · 멈춤" : tt >= GOT_A ? "채점 중" : "쉬는 중");
    var showA = seg(tt, GOT_A, 300) * (1 - seg(tt, FLIP, 300)) * fade;
    set(capA, "opacity", String(showA));
    set(capAText, "text", tt >= STALL ? "연장 끊김" : "10초마다 연장");
    var exp = s >= 20 ? 80 : s >= 10 ? 70 : 60, remA = Math.max(0, exp - s);
    HB.forEach(function (h) { var e = seg(tt, h, 300); if (e > 0 && e < 1) remA = exp - 10 - s + 10 * out(e); });
    ring(ringA, tt, tt < GOT_A ? 60 : remA, showA, PATROL, HB);

    // 워커 B: 새 시도로 채점하고 결과 저장
    set(wb, ".is-run", tt >= GOT_B && tt < SAVE);
    set(wb, ".is-done", tt >= SAVE);
    set(chipB, "text", tt >= SAVE ? "판정 완료" : tt >= GOT_B ? "채점 중" : "쉬는 중");
    var showB = seg(tt, GOT_B, 300) * (1 - seg(tt, RES_B, 200)) * fade; // 채점을 마치면 시계를 걷고 결과를 보낸다
    set(capB, "opacity", String(showB));
    ring(ringB, tt, tt < GOT_B ? 60 : 60 - (s - sim(GOT_B)), showB, [], []);

    // 복구 순찰: 30초마다 돌고, 세 번째에 만료를 찾는다
    var spin = 0;
    PATROL.forEach(function (p, i) {
      spin += 360 * out(seg(tt, p, 800));
      var e = out(seg(tt, p + 150, 400));
      set(logs[i], "opacity", String(e * fade));
      set(logs[i], "transform", "translateY(" + (10 * (1 - e)).toFixed(1) + "px)");
    });
    set(patrolIco, "transform", "rotate(" + spin.toFixed(1) + "deg)");
    set(back, "@stroke-dashoffset", (1 - out(seg(tt, FLIP, 450))).toFixed(3));
    set(back, "opacity", String(tt >= FLIP ? fade : 0));

    // 서버: 지금 인정하는 세대와 시도, 도착한 결과
    var changes = [GOT_A, FLIP, GOT_B, SAVE], last = -1;
    changes.forEach(function (c, i) { if (tt >= c) last = i; });
    set(nowVal, "text", ["아직 없음 · 줄에서 대기", "세대 1 · 워커 A의 시도", "세대 2 · 줄에서 대기", "세대 2 · 워커 B의 새 시도", "세대 2 · 판정 완료"][last + 1]);
    set(nowVal, ".is-live", last === 0 || last === 2);
    set(nowVal, "opacity", String((last < 0 ? 1 : seg(tt, changes[last], 250)) * fade));
    set(empty, "opacity", String((1 - seg(tt, SAVE - 150, 200)) * fade));
    [[rowOk, SAVE], [rowNo, REJECT]].forEach(function (p) {
      var e = out(seg(tt, p[1], 450));
      set(p[0], "opacity", String(e * fade));
      set(p[0], "transform", "translateX(" + (-18 * (1 - e)).toFixed(1) + "px)");
    });
    // 결과 봉투: B의 것은 서버로 들어가고, A의 것은 서버 앞에서 튕겨 나온다
    var eb = inOut(seg(tt, RES_B + 150, SAVE - RES_B - 150));
    set(envB, "transform", "translate(" + (850 + 250 * eb).toFixed(1) + "px, 457px)");
    set(envB, "opacity", String(tt >= RES_B && tt < SAVE + 150 ? seg(tt, RES_B + 100, 120) * (1 - seg(tt, SAVE - 40, 180)) : 0));
    var ea = inOut(seg(tt, RES_A, REJECT - RES_A)), bump = seg(tt, REJECT, 380);
    set(envA, "transform", "translate(" + (600 + 352 * ea - 40 * out(bump)).toFixed(1) + "px, 177px)");
    set(envA, "opacity", String(tt >= LATE && bump < 1 ? seg(tt, LATE, 200) * (1 - seg(tt, REJECT + 150, 230)) : 0));
    set(envA, ".is-bad", tt >= REJECT);

    // 마무리: XP 규칙
    var x = out(seg(tt, XP, 600));
    set(xp, "opacity", String(x * fade));
    set(xp, "transform", "translateY(" + (20 * (1 - x)).toFixed(1) + "px)");
  }

  // 장면을 순간 이동할 때(시작 · 멈춤)는 CSS 전환 없이 바로 그린다.
  var stage = q(".rc-stage");
  function jump(t) { stage.classList.add("is-jump"); render(t); void stage.offsetWidth; stage.classList.remove("is-jump"); }
  var STILL = XP + 1500; // 멈춰 있을 때 보이는 장면: 마지막 정리 화면(전체 보기 · 인쇄 · 장면 전환 중에도 이 화면)

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
