// 星環電路 多人版 · main.js：啟動：初始化、主迴圈 frame()
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// BOOT
// =====================================================================
resize();
initStars();
GLR.init();  // WebGL 繪圖層
Editor.init();
TouchUI.init();
Codex.init();
Screen.el.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) Screen.act(b);
});
// 設定頁的滑桿（0～100 → 0～1）、勾選框
Screen.el.addEventListener('input', e => {
  const t = e.target.closest('[data-set]');
  if (!t) return;
  const k = t.dataset.set, v = t.type === 'checkbox' ? t.checked : +t.value / 100;
  Settings.set(k, v);
  const lab = Screen.el.querySelector(`[data-setv="${k}"]`);
  if (lab) lab.textContent = Math.round(v * 100) + '%';
});
if (matchMedia('(pointer: coarse)').matches) setTouchMode(true);
unlockLoad();  // 存檔升級（2.20.0 以前的紀錄刪掉、章節進度重來、補新的成績），要在標題畫面之前
Screen.title();
if (Tutorial.firstRun()) Tutorial.begin();  // 第一次開遊戲：直接進新手引導（看過就不再自動進）
SFX.setMuted(SFX.muted);  // 依記住的設定更新靜音按鈕文字
// 網址帶 #charts 或 #mech 時直接打開對應的總覽分頁（方便分享、檢查）
if (['#charts', '#mech', '#rules', '#chips', '#comps', '#weapons'].includes(location.hash)) Codex.open(location.hash.slice(1));

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  FPS.tick(now);
  Game.notePerf(now - last);  // 遊玩紀錄：最慢的一幀
  last = now;
  TouchUI.sync();
  Music.update();
  Net.tick(dt);
  let gdt = Game.mode === 'range' && Range.slow ? dt * Range.SLOW : dt;  // 靶場慢動作
  if (Game.hitstopT > 0) { Game.hitstopT -= dt; gdt *= PARRY.stopScale; }  // 頓幀（能量刃彈反成功）
  Game.update(gdt);
  if (Hub.shown() && (Hub.seq || (Hub.driving && !Codex.isOpen))) Hub.update(dt);  // 基地：開著飛船走（開了面板、總覽就停；出發動畫照播）
  if (Game.mode === 'range' && Game.state === 'play') Range.tick(gdt);  // 靶場「擋彈」：標靶射彈幕
  if (Game.mode === 'tutorial' && Game.state === 'play') Tutorial.tick(dt);  // 新手引導：換下一步、按住 Esc 跳過
  RangeBar.sync();  // 靶場按鈕列（只在靶場戰鬥中顯示）
  NetView.tick();  // 多人的倒數數字（重連、投票、出發）
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
