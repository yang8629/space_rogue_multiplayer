// 星環電路 雙人版 · input.js：鍵盤滑鼠、觸控雙搖桿、畫面尺寸 resize
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// INPUT
// =====================================================================
const Input = { keys: new Set(), mx: 0, my: 0, down: false, dash: false, dashHeld: false,  // dashHeld：衝刺鍵按住中（冷卻好就自動再衝；不靠系統的按鍵重複，按別的鍵也不會斷）
  touch: false,                    // 偵測到觸控後切換為雙搖桿操作
  autoFire: true,                  // 手機自動攻擊（可切換，記在瀏覽器）
  joy: null, aimStick: null };     // { id, bx, by, x, y }

addEventListener('keydown', e => {
  if (e.key === 'Shift' && !e.repeat) document.body.classList.toggle('detail');  // 按 Shift：卡片切換精簡／詳細說明
  const k = e.key.toLowerCase();
  if (Codex.isOpen) {  // 總覽開著時：Esc 關閉，其他按鍵不影響遊戲
    if (k === 'escape') Codex.close();
    if (k === 'tab') e.preventDefault();
    return;
  }
  if (k === 'tab') { e.preventDefault(); if (!e.repeat) Game.toggleEditor(); return; }
  if (Game.mode === 'range' && Game.state === 'play' && !e.repeat && Range.key(k, e.shiftKey)) return;
  if (k === ' ') { e.preventDefault(); if (Game.state === 'play') { Input.dash = true; Input.dashHeld = true; } return; }
  Input.keys.add(k);
  if (k === 'escape' && Game.state === 'editor') { Game.toggleEditor(); return; }
  if (k === 'escape' && Game.state === 'play' && !e.repeat) { Game.togglePauseMenu(); return; }  // 戰鬥中：選單（繼續／離開遊戲）
  if (k === 'escape' && !e.repeat) {  // Esc：按下畫面上標了 data-back 的返回鍵（只有不會造成損失的返回，例如選武器 → 選飛船）
    const back = !Screen.el.classList.contains('hidden') && Screen.el.querySelector('[data-back]');
    if (back) { Screen.act(back); return; }
  }
  if (k === 'enter' && Game.state === 'title') Screen.select('run');
  if (k === 'enter' && Game.state === 'lobby' && document.activeElement && document.activeElement.id === 'netCode') Net.join(document.activeElement.value);
  if (k === 'r' && Game.state === 'dead' && Game.mode !== 'coop') Screen.restart();
});
addEventListener('keyup', e => {
  if (e.key === ' ') Input.dashHeld = false;
  Input.keys.delete(e.key.toLowerCase());
});
addEventListener('blur', () => { Input.keys.clear(); Input.down = false; Input.dashHeld = false; });

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const canvasPos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
addEventListener('mousemove', e => { const p = canvasPos(e); Input.mx = p.x; Input.my = p.y; });
canvas.addEventListener('mousedown', e => {
  if (Game.state !== 'play' || Input.touch) return;
  if (e.button === 0) Input.down = true;
  if (e.button === 2) { Input.dash = true; Input.dashHeld = true; }
});
addEventListener('mouseup', e => { if (e.button === 0) Input.down = false; if (e.button === 2) Input.dashHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---- 觸控：左半邊移動搖桿、右半邊瞄準射擊（輕觸不拖曳 = 自動瞄準最近敵人） ----
function setTouchMode(on) {
  if (Input.touch === on) return;
  Input.touch = on;
  TouchUI.sync();
}
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { setTouchMode(false); return; }
  setTouchMode(true);
  if (Game.state !== 'play') return;
  const p = canvasPos(e), stick = { id: e.pointerId, bx: p.x, by: p.y, x: p.x, y: p.y };
  // 自動攻擊開啟時沒有瞄準搖桿：整個畫面都只當移動搖桿
  if (Input.autoFire || p.x < VW / 2) { if (!Input.joy) Input.joy = stick; }
  else if (!Input.aimStick) Input.aimStick = stick;
});
canvas.addEventListener('pointermove', e => {
  const p = canvasPos(e);
  for (const s of [Input.joy, Input.aimStick]) if (s && s.id === e.pointerId) { s.x = p.x; s.y = p.y; }
});
function releasePointer(e) {
  if (Input.joy && Input.joy.id === e.pointerId) Input.joy = null;
  if (Input.aimStick && Input.aimStick.id === e.pointerId) Input.aimStick = null;
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
function stickVec(s, max = 60) {
  const dx = s.x - s.bx, dy = s.y - s.by, l = Math.hypot(dx, dy);
  if (l < 1) return { x: 0, y: 0, len: 0 };
  const m = Math.min(1, l / max);
  return { x: dx / l * m, y: dy / l * m, len: l };
}

const TouchUI = {
  el: document.getElementById('touchUI'),
  init() {
    const dash = document.getElementById('tDash'), edit = document.getElementById('tEdit');
    document.getElementById('tMenu').addEventListener('click', () => { if (Game.state === 'play') Game.togglePauseMenu(); });
    this.autoBtn = document.getElementById('tAuto');
    try { if (localStorage.getItem('autoFire') === '0') Input.autoFire = false; } catch (e) {}
    dash.addEventListener('pointerdown', e => { e.preventDefault(); if (Game.state === 'play') { Input.dash = true; Input.dashHeld = true; } });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) dash.addEventListener(ev, () => { Input.dashHeld = false; });
    edit.addEventListener('click', () => Game.toggleEditor());
    this.autoBtn.addEventListener('click', () => {
      Input.autoFire = !Input.autoFire;
      if (Input.autoFire) Input.aimStick = null;
      try { localStorage.setItem('autoFire', Input.autoFire ? '1' : '0'); } catch (e) {}
      this.renderAuto();
    });
    this.renderAuto();
  },
  renderAuto() {
    this.autoBtn.innerHTML = `自動<br>${Input.autoFire ? '開' : '關'}`;
    this.autoBtn.classList.toggle('off', !Input.autoFire);
  },
  sync() { this.el.classList.toggle('hidden', !(Input.touch && Game.state === 'play' && !Game.pauseMenu)); },
};

// 畫面尺寸與鏡頭縮放：小螢幕自動拉遠，保持足夠的視野
let VW = 0, VH = 0, DPR = 1, ZOOM = 1, ZW = 0, ZH = 0;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  VW = document.body.clientWidth || innerWidth; VH = document.body.clientHeight || innerHeight;
  canvas.width = VW * DPR; canvas.height = VH * DPR;
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
  ZOOM = clamp(Math.min(VW, VH) / 720, 0.55, 1);
  ZW = VW / ZOOM; ZH = VH / ZOOM;
}
addEventListener('resize', resize);
