// 星環電路 多人版 · audio.js：音效 SFX、背景音樂 Music（都是音檔）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 音檔（assets/sfx_data.js 的 SFX_DATA：Kenney 的 CC0 音效，tools/audio/build_sfx.js 產生；來源見 assets/sfx/LICENSE.txt）
//   key = play 的聲音名稱（射擊是「shoot:武器」、右鍵是「alt:武器」）；file = SFX_DATA 的哪個檔、vol 音量、gap 同一種最短間隔（毫秒）、pitch 每次隨機升降調的幅度（常聽到的聲音不那麼單調）
//   from／dur：只播音檔的一段（秒，結尾淡出；長的推進器聲切一小段當破風聲）、rate：播放速度（>1 音調變高、變短）
//   10-24 使用者：音效統一用音檔（以前是 Web Audio 即時合成）
const SFX_FILE = {
  'shoot:laser': { file: 'laser', vol: 0.6, gap: 45, pitch: 0.06 },  // 音檔本身小聲（平均 -22 dB）：0.25 → 0.6（10-25 使用者：太小聲）
  'shoot:scatter': { file: 'flywheel', vol: 0.3, gap: 60, pitch: 0.1 },  // 金屬鋸齒輪甩出去（10-25 使用者：以前的刮擦聲像黃色小鴨）
  'shoot:plasma': { file: 'gravity', vol: 0.25, gap: 80, pitch: 0.08 },
  'shoot:railgun': { file: 'hook', vol: 0.4, gap: 50, pitch: 0.08 },
  'shoot:drone': { file: 'drone', vol: 0.15, gap: 45, pitch: 0.12 },
  'shoot:blade': { file: 'whoosh', vol: 0.45, gap: 60, pitch: 0.12, from: 0.2, dur: 0.2, rate: 1.6 },  // 刃片破風聲（推進器聲切一小段、調高）
  'alt:laser': { file: 'vent', vol: 0.6, gap: 200 },           // 排熱
  'alt:scatter': { file: 'recall', vol: 0.45, gap: 200 },      // 召回
  'alt:plasma': { file: 'collapse', vol: 0.6, gap: 200 },      // 塌縮
  'alt:railgun': { file: 'whoosh', vol: 0.6, gap: 200, from: 0.2, dur: 0.4, rate: 1.1 },  // 甩擊
  'alt:blade': { file: 'parry', vol: 0.5, gap: 200, pitch: 0.05 },  // 彈反
  'alt:drone': { file: 'guard', vol: 0.4, gap: 200 },          // 收攏
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
  dash: { file: 'whoosh', vol: 0.5, gap: 80, from: 0.2, dur: 0.3, rate: 0.85 },  // 低沉的噴射破風聲（10-25 使用者：以前的介面提示音太尖銳）
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
  sample(b, F) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), t = c.currentTime;
    s.buffer = b; s.playbackRate.value = (F.rate || 1) * (1 + (Math.random() * 2 - 1) * (F.pitch || 0));
    g.gain.setValueAtTime(F.vol, t);
    s.connect(g); g.connect(this.master);
    if (!F.dur) { s.start(); return; }
    const real = F.dur / s.playbackRate.value;  // 切一段：結尾 30% 淡出（不然切斷處會喀一聲）
    g.gain.setValueAtTime(F.vol, t + real * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + real);
    s.start(t, F.from || 0, F.dur);
  },
  gainNow() { return this.muted ? 0 : this.VOLUME * Settings.vol; },  // 音效音量（設定頁；只管音效，音樂另外一條：Music.gainNow）
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
    const key = name === 'shoot' || name === 'alt' ? name + ':' + arg : name, F = SFX_FILE[key], b = F && this.buf[F.file];
    if (b && this.ready(key, F.gap)) this.sample(b, F);
  },
};
if (Save.flag('muted', false)) SFX.muted = true;

// =====================================================================
// MUSIC — 背景音樂（assets/music/*.mp3：OpenGameArt 的 CC0 曲子，來源見 assets/music/LICENSE.txt；10-24 以前是即時合成）
//   calm：基地、航圖、商店；battle：一般戰鬥；boss_<旗艦 id>：每隻王一首（使用者 10-24：王的音樂要不一樣）。用 <audio loop> 播（遊戲用 file:// 開也能播）；換曲時交叉淡出淡入
//   第一次要播才建 <audio>、開始下載（一進遊戲不會把 7 首都載下來）
//   音量 = 基本音量（SFX.VOLUME）× VOL × 設定頁的音樂音量；跟音效音量分開（10-25 使用者），靜音（M）一起關；另外可以單獨關掉音樂
// =====================================================================
const MUSIC_FILE = { calm: 'assets/music/calm.mp3', battle: 'assets/music/battle.mp3',
  boss_boss: 'assets/music/boss_boss.mp3', boss_boss2: 'assets/music/boss_boss2.mp3', boss_boss3: 'assets/music/boss_boss3.mp3',
  boss_boss4: 'assets/music/boss_boss4.mp3', boss_boss5: 'assets/music/boss_boss5.ogg' };
const Music = {
  on: true, track: null, els: null, vol: {}, last: 0, VOL: 0.6, FADE: 0.8,  // FADE：淡入淡出幾秒
  init() { if (!this.els && typeof Audio !== 'undefined') this.els = {}; },
  el(k) {  // 這首的 <audio>（第一次用到才建）
    if (!this.els[k]) { const a = new Audio(MUSIC_FILE[k]); a.loop = true; a.volume = 0; this.els[k] = a; this.vol[k] = 0; }
    return this.els[k];
  },
  toggle() {
    this.on = !this.on;
    Save.setFlag('music', this.on);
  },
  gainNow() { return this.on && !SFX.muted ? SFX.VOLUME * this.VOL * Settings.musicVol : 0; },
  // 每一幀依遊戲狀態決定要播哪首；每首的音量往目標慢慢移（要播的淡入、其他淡出），淡到 0 就暫停；設定頁的音量、靜音也是每幀照算
  update() {
    if (!this.els) return;
    const boss = Game.inArena && Game.enemies.find(e => e.t.boss && !e.dead);
    const bossKey = 'boss_' + (boss ? boss.type : Game.bossId);  // 王還沒出場（旗艦戰剛開始）就照這一關的旗艦
    this.track = Game.state === 'dead' ? null : Game.inArena ? (boss || (Game.combat && Game.combat.boss) ? (MUSIC_FILE[bossKey] ? bossKey : 'battle') : 'battle') : 'calm';
    if (this.track) this.el(this.track);
    const now = performance.now(), dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;
    const full = this.gainNow();
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
