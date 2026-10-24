// 星環電路 多人版 · audio.js：音效 SFX、背景音樂 Music（都是音檔）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 音檔（assets/sfx_data.js 的 SFX_DATA：Kenney 的 CC0 音效，tools/audio/build_sfx.js 產生；來源見 assets/sfx/LICENSE.txt）
//   key = play 的聲音名稱（射擊是「shoot:武器」）；file = SFX_DATA 的哪個檔、vol 音量、gap 同一種最短間隔（毫秒）、pitch 每次隨機升降調的幅度（常聽到的聲音不那麼單調）
//   10-24 使用者：音效統一用音檔（以前是 Web Audio 即時合成）
const SFX_FILE = {
  'shoot:laser': { file: 'laser', vol: 0.25, gap: 45, pitch: 0.06 },
  'shoot:scatter': { file: 'flywheel', vol: 0.35, gap: 60, pitch: 0.1 },
  'shoot:plasma': { file: 'gravity', vol: 0.25, gap: 80, pitch: 0.08 },
  'shoot:railgun': { file: 'hook', vol: 0.4, gap: 50, pitch: 0.08 },
  'shoot:drone': { file: 'drone', vol: 0.15, gap: 45, pitch: 0.12 },
  'shoot:blade': { file: 'blade', vol: 0.35, gap: 60, pitch: 0.12 },
  hit: { file: 'hit', vol: 0.35, gap: 35, pitch: 0.12 },
  kill: { file: 'kill', vol: 0.45, gap: 30, pitch: 0.1 },
  bigkill: { file: 'bigkill', vol: 0.7, gap: 80 },
  explode: { file: 'bigkill', vol: 0.4, gap: 60, pitch: 0.15 },
  eshot: { file: 'eshot', vol: 0.12, gap: 90, pitch: 0.1 },       // 敵人開火（很頻繁，小聲）
  trigger: { file: 'trigger', vol: 0.22, gap: 70, pitch: 0.2 },   // 晶片觸發
  boss: { file: 'warn', vol: 0.45, gap: 400 },                     // 王出招、警報艇響、彗星來了
  bossin: { file: 'bossin', vol: 0.9, gap: 500 },                  // 旗艦出現
  bossdeath: { file: 'bossdeath', vol: 0.9, gap: 500 },
  hurt: { file: 'hurt', vol: 0.7, gap: 80 },
  death: { file: 'death', vol: 0.8, gap: 500 },
  dash: { file: 'dash', vol: 0.4, gap: 80 },
  pickup: { file: 'pickup', vol: 0.3, gap: 40, pitch: 0.15 },
  wave: { file: 'wave', vol: 0.4, gap: 200 },
  clear: { file: 'clear', vol: 0.5, gap: 200 },
  click: { file: 'click', vol: 0.4, gap: 40 },
  upgrade: { file: 'upgrade', vol: 0.6, gap: 100 },
  fuseok: { file: 'upgrade', vol: 0.6, gap: 100 },
  fusefail: { file: 'fusefail', vol: 0.6, gap: 200 },
  fusing: { file: 'fusing', vol: 0.5, gap: 200 },
};

// =====================================================================
// SFX — 音效：照 SFX_FILE 播音檔
//   瀏覽器規定要使用者互動後才能發聲，所以在第一次點擊或按鍵時 init（解碼音檔要一點時間，解好之前不出聲）
//   同一種聲音有最短間隔（gap），避免高射速時變成噪音
// =====================================================================
const SFX = {
  ctx: null, master: null, muted: false, last: {}, buf: {},
  VOLUME: 0.35,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.gainNow();
      this.master.connect(this.ctx.destination);
      this.loadFiles();
    } catch (e) { this.ctx = null; }
    Music.init();
  },
  // 把 SFX_DATA 的音檔解碼好放進 buf（非同步）
  loadFiles() {
    const D = globalThis.SFX_DATA;
    if (!D) return;
    for (const [k, b64] of Object.entries(D)) {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      this.ctx.decodeAudioData(bin.buffer).then(b => { this.buf[k] = b; }).catch(() => {});
    }
  },
  sample(b, vol, pitch = 0) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = b; s.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch;
    g.gain.value = vol;
    s.connect(g); g.connect(this.master); s.start();
  },
  gainNow() { return this.muted ? 0 : this.VOLUME * Settings.vol; },  // 主音量（設定頁）
  applyVolume() { if (this.master) this.master.gain.value = this.gainNow(); },
  setMuted(m) {
    this.muted = m;
    this.applyVolume();
    Save.setFlag('muted', m);
    document.querySelectorAll('[data-act="mute"]').forEach(b => b.textContent = m ? '🔇 音效關' : '🔊 音效開');
  },
  ready(key, gap) {
    if (!this.ctx || this.muted) return false;
    const t = performance.now();
    if (this.last[key] && t - this.last[key] < gap) return false;
    this.last[key] = t;
    return true;
  },
  play(name, arg) {
    // 房主的戰場音效轉給隊友（受傷、衝刺、介面音效各自在自己的電腦播）
    if (Net.role === 'host' && !['hurt', 'death', 'dash', 'click', 'upgrade'].includes(name)) Net.fx(['s', name, arg]);
    if (!this.ctx || this.muted) return;  // 音效還沒啟動（或瀏覽器不支援）時直接略過，不能讓遊戲當掉
    const key = name === 'shoot' ? 'shoot:' + arg : name, F = SFX_FILE[key], b = F && this.buf[F.file];
    if (b && this.ready(key, F.gap)) this.sample(b, F.vol, F.pitch);
  },
};
if (Save.flag('muted', false)) SFX.muted = true;

// =====================================================================
// MUSIC — 背景音樂（assets/music/*.mp3：OpenGameArt 的 CC0 曲子，來源見 assets/music/LICENSE.txt；10-24 以前是即時合成）
//   calm：基地、航圖、商店；battle：一般戰鬥；boss：旗艦戰。用 <audio loop> 播（遊戲用 file:// 開也能播）；換曲時交叉淡出淡入
//   音量 = 音效的主音量（含靜音）× VOL × 設定頁的音樂音量；另外可以單獨關掉音樂
// =====================================================================
const MUSIC_FILE = { calm: 'assets/music/calm.mp3', battle: 'assets/music/battle.mp3', boss: 'assets/music/boss.mp3' };
const Music = {
  on: true, track: null, els: null, vol: {}, last: 0, VOL: 0.6, FADE: 0.8,  // FADE：淡入淡出幾秒
  init() {
    if (this.els || typeof Audio === 'undefined') return;
    this.els = {};
    for (const [k, src] of Object.entries(MUSIC_FILE)) { const a = new Audio(src); a.loop = true; a.preload = 'auto'; a.volume = 0; this.els[k] = a; this.vol[k] = 0; }
  },
  toggle() {
    this.on = !this.on;
    Save.setFlag('music', this.on);
  },
  // 每一幀依遊戲狀態決定要播哪首；每首的音量往目標慢慢移（要播的淡入、其他淡出），淡到 0 就暫停；設定頁的音量、靜音也是每幀照算
  update() {
    if (!this.els) return;
    const boss = Game.inArena && Game.enemies.find(e => e.t.boss && !e.dead);
    this.track = Game.state === 'dead' ? null : Game.inArena ? (boss || (Game.combat && Game.combat.boss) ? 'boss' : 'battle') : 'calm';
    const now = performance.now(), dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;
    const full = this.on ? SFX.gainNow() * this.VOL * Settings.musicVol : 0;
    for (const [k, a] of Object.entries(this.els)) {
      const want = k === this.track ? full : 0, v = this.vol[k], step = dt / this.FADE * Math.max(full, v, 0.05);  // 照比較大的那個算：淡入淡出都是 FADE 秒左右
      this.vol[k] = want > v ? Math.min(want, v + step) : Math.max(want, v - step);
      a.volume = clamp(this.vol[k], 0, 1);
      if (this.vol[k] > 0 && a.paused) a.play().catch(() => {});  // 瀏覽器還不讓播（使用者還沒互動）：下一幀再試
      else if (this.vol[k] === 0 && !a.paused) a.pause();
    }
  },
};
if (!Save.flag('music', true)) Music.on = false;  // 載入時就讀，標題畫面的按鈕才不會先顯示「開」

addEventListener('pointerdown', () => SFX.init(), { capture: true });
addEventListener('keydown', e => {
  SFX.init();
  if (e.key.toLowerCase() === 'm' && !e.repeat) SFX.setMuted(!SFX.muted);
}, { capture: true });
