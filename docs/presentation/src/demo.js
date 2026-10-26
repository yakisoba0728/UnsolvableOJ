// 실제 동작 영상 장: 장이 보이면 처음부터 재생하고, 지금 장면에 맞춰 단계 목록·자막·진행 막대를 바꾼다.
(function () {
  const slide = document.getElementById("demo-slide");
  if (!slide) return;
  const video = slide.querySelector("video");
  const data = JSON.parse(slide.querySelector('script[type="application/json"]').textContent);
  const moments = data.moments || [];
  const start = data.startOffset || 0;
  const end = () => data.duration || video.duration || 0;
  const caption = slide.querySelector(".cap-live");
  const fill = slide.querySelector(".bar-fill");
  const list = slide.querySelector(".video-steps");
  const items = moments.map((moment, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="i">${index + 1}</span><span class="l"></span>`;
    li.querySelector(".l").textContent = moment.label;
    list.appendChild(li);
    return li;
  });
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let hold = 0;
  let frame = 0;

  function paint() {
    const t = video.currentTime;
    let current = -1;
    moments.forEach((moment, index) => { if (t >= moment.t) current = index; });
    items.forEach((li, index) => {
      li.classList.toggle("on", index === current);
      li.classList.toggle("done", index < current);
    });
    if (current >= 0) { caption.textContent = moments[current].label; caption.classList.add("on"); }
    else caption.classList.remove("on");
    const span = end() - start;
    fill.style.width = span > 0 ? `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%` : "0%";
    if (data.duration && t >= data.duration && !video.paused) finish();
    if (!video.paused) frame = requestAnimationFrame(paint);
  }
  function finish() {
    video.pause();
    clearTimeout(hold);
    hold = setTimeout(play, 2500); // 마지막 장면을 잠깐 보여 준 뒤 다시 처음부터
  }
  function play() {
    clearTimeout(hold);
    cancelAnimationFrame(frame);
    video.currentTime = start;
    video.play().then(() => { frame = requestAnimationFrame(paint); }).catch(() => {});
  }
  function stop() {
    clearTimeout(hold);
    cancelAnimationFrame(frame);
    video.pause();
  }
  video.addEventListener("ended", finish);
  video.addEventListener("seeked", paint);

  if (still) {
    // 움직임 줄이기: 자동 재생 대신 직접 재생하게 한다.
    video.controls = true;
    return;
  }
  let active = false;
  const sync = () => {
    const now = slide.classList.contains("is-active");
    if (now !== active) (active = now) ? play() : stop();
  };
  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ["class"] });
  sync();
})();
