// 星環電路 雙人版 · main.js：啟動：初始化、主迴圈 frame()
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// BOOT
// =====================================================================
resize();
initStars();
Editor.init();
TouchUI.init();
Codex.init();
Screen.el.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) Screen.act(b);
});
if (matchMedia('(pointer: coarse)').matches) setTouchMode(true);
Screen.title();
SFX.setMuted(SFX.muted);  // 依記住的設定更新靜音按鈕文字
// 網址帶 #charts 或 #mech 時直接打開對應的總覽分頁（方便分享、檢查）
if (['#charts', '#mech', '#rules', '#chips', '#comps', '#weapons'].includes(location.hash)) Codex.open(location.hash.slice(1));

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  FPS.tick(now);
  last = now;
  TouchUI.sync();
  Music.update();
  Net.tick(dt);
  const gdt = Game.mode === 'range' && Range.slow ? dt * Range.SLOW : dt;  // 靶場慢動作
  Game.update(gdt);
  if (Game.mode === 'range' && Game.state === 'play') Range.tick(gdt);  // 靶場「擋彈」：標靶射彈幕
  Range.syncBar();  // 靶場按鈕列（只在靶場戰鬥中顯示）
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
