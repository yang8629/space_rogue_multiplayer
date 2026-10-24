// 星環電路 多人版 · settings.js：設定（設定頁 Screen.settings）：音量、畫面震動、FPS、卡片預設顯示完整說明、測試用全部解鎖
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html（接在 audio.js 後面）
//   存在瀏覽器（SETTINGS_KEY）；音效開關、音樂開關沿用原本的 muted、music（audio.js）
'use strict';

const Settings = {
  master: 1,      // 總音量（0～1，音效、音樂都乘；10-25 使用者：分開之後總音量還是要在）
  vol: 1,         // 音效音量（0～1，乘在 SFX.VOLUME 上；不影響音樂。欄位名沿用以前的主音量，存檔不用改）
  musicVol: 1,    // 音樂音量（0～1，乘在 Music.VOL 上）
  shake: true,    // 畫面震動（爆炸、撞牆、旗艦落地）
  fps: true,      // 戰鬥畫面右上角顯示 FPS
  detail: false,  // 卡片預設顯示完整說明（按 Shift 還是可以臨時切換）
  unlockAll: false,  // 測試用：全部解鎖（= CFG.UNLOCK_ALL；飛船、武器、晶片、章節全開，進度照樣記）
  load() {
    let p = {};
    p = Save.load('settings', {});
    const n01 = (v, d) => Number.isFinite(+v) ? clamp(+v, 0, 1) : d, b = (v, d) => typeof v === 'boolean' ? v : d;
    this.master = n01(p.master, 1); this.vol = n01(p.vol, 1); this.musicVol = n01(p.musicVol, 1);
    this.shake = b(p.shake, true); this.fps = b(p.fps, true); this.detail = b(p.detail, false); this.unlockAll = b(p.unlockAll, false);
    CFG.UNLOCK_ALL = this.unlockAll;
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('detail', this.detail);
  },
  set(k, v) {
    if (!(k in this) || typeof this[k] === 'function') return;
    this[k] = v;
    Save.save('settings', { master: this.master, vol: this.vol, musicVol: this.musicVol, shake: this.shake, fps: this.fps, detail: this.detail, unlockAll: this.unlockAll });
    if (k === 'unlockAll') CFG.UNLOCK_ALL = v;  // 基地的武器架、停機位每幀照 isUnlocked 畫，馬上跟著變
    if (k === 'vol' || k === 'master') SFX.applyVolume();
    if (k === 'detail') document.body.classList.toggle('detail', v);
  },
};
Settings.load();
