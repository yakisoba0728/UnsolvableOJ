/* 장면 "concept": 장이 보이는(.is-active) 동안 13.6초짜리 시간표를 반복 재생한다.
 * 마크업의 data-at(ms)이 지나면 .on, data-until이 지나면 .off를 붙이고, 모양은 scene.css가 정한다.
 * 장을 떠나면 멈추고 처음 상태로 되돌린다. 움직임 줄이기 설정이면 재생하지 않아 마지막 장면만 보인다.
 */
(function () {
  "use strict";
  var sec = document.getElementById("scene-concept");
  if (!sec) return;

  var CYCLE = 13600; // 마지막 동작 10.6초 → 2.5초 멈춤 → 0.5초 동안 지우고 처음으로
  var OUTRO = 13100;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var items = Array.prototype.map.call(sec.querySelectorAll("[data-at]"), function (el) {
    var until = el.getAttribute("data-until");
    return { el: el, at: Number(el.getAttribute("data-at")), until: until === null ? Infinity : Number(until) };
  });
  var passTimes = Array.prototype.map.call(sec.querySelectorAll(".cc-chip .pass"), function (el) {
    return Number(el.getAttribute("data-at"));
  });
  var counter = sec.querySelector(".cc-n");
  var bar = sec.querySelector(".cc-cfill");
  var raf = 0;
  var start = 0;
  var loop = -1;
  var shown = -1;

  function apply(t) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.el.classList.toggle("on", t >= it.at);
      if (it.until !== Infinity) it.el.classList.toggle("off", t >= it.until);
    }
    sec.classList.toggle("outro", t >= OUTRO);
    var n = 0;
    for (var j = 0; j < passTimes.length; j++) if (t >= passTimes[j]) n++;
    if (n !== shown) show((shown = n));
  }

  function show(n) {
    if (counter) counter.textContent = String(n);
    if (bar) bar.style.transform = "scaleX(" + n / passTimes.length + ")";
  }

  // 전환 효과 없이 한 번에 상태를 바꾼다. t가 null이면 재생 전(마지막 장면) 상태.
  function snapTo(t) {
    sec.classList.add("snap");
    sec.classList.toggle("playing", t !== null);
    sec.classList.remove("outro");
    for (var i = 0; i < items.length; i++) items[i].el.classList.remove("on", "off");
    shown = -1;
    if (t === null) show(passTimes.length);
    else apply(t);
    void sec.offsetWidth;
    sec.classList.remove("snap");
  }

  function frame(now) {
    var elapsed = Math.max(0, now - start);
    var k = Math.floor(elapsed / CYCLE);
    if (k !== loop) {
      loop = k;
      snapTo(elapsed - k * CYCLE);
    } else apply(elapsed - k * CYCLE);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (raf || reduce) return;
    start = performance.now();
    loop = 0;
    snapTo(0);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!raf && !sec.classList.contains("playing")) return;
    cancelAnimationFrame(raf);
    raf = 0;
    snapTo(null);
  }

  function sync() {
    if (sec.classList.contains("is-active")) play();
    else stop();
  }

  new MutationObserver(sync).observe(sec, { attributes: true, attributeFilter: ["class"] });
  sync();
})();
