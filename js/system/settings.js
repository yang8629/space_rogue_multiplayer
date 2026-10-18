// 星環電路 多人版 · settings.js：設定（設定頁 Screen.settings）：音量、畫面震動、FPS、卡片預設顯示完整說明
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html（接在 audio.js 後面）
//   存在瀏覽器（SETTINGS_KEY）；音效開關、音樂開關沿用原本的 muted、music（audio.js）
'use strict';

const SETTINGS_KEY = 'v2_settings';
const Settings = {
  vol: 1,         // 主音量（0～1，乘在 SFX.VOLUME 上；音樂接在音效後面，一起變）
  musicVol: 1,    // 音樂音量（0～1，乘在 Music.VOL 上）
  shake: true,    // 畫面震動（爆炸、撞牆、旗艦落地）
  fps: true,      // 戰鬥畫面右上角顯示 FPS
  detail: false,  // 卡片預設顯示完整說明（按 Shift 還是可以臨時切換）
  load() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { p = {}; }
    const n01 = (v, d) => Number.isFinite(+v) ? clamp(+v, 0, 1) : d, b = (v, d) => typeof v === 'boolean' ? v : d;
    this.vol = n01(p.vol, 1); this.musicVol = n01(p.musicVol, 1);
    this.shake = b(p.shake, true); this.fps = b(p.fps, true); this.detail = b(p.detail, false);
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('detail', this.detail);
  },
  set(k, v) {
    if (!(k in this) || typeof this[k] === 'function') return;
    this[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ vol: this.vol, musicVol: this.musicVol, shake: this.shake, fps: this.fps, detail: this.detail })); } catch (e) {}
    if (k === 'vol') SFX.applyVolume();
    if (k === 'musicVol') Music.applyVolume();
    if (k === 'detail') document.body.classList.toggle('detail', v);
  },
};
Settings.load();
