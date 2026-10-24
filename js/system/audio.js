// 星環電路 多人版 · audio.js：音效 SFX（音檔）、背景音樂 Music（Web Audio 即時合成）
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
  ctx: null, master: null, noise: null, muted: false, last: {}, buf: {},
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
      const len = this.ctx.sampleRate * 0.6, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);  // 白噪音（背景音樂的鼓用）
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
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
// MUSIC — 背景音樂（Web Audio 即時合成，不需要音檔）
//   calm  ：航圖、商店等畫面，D 小調慢速鋪底＋琶音
//   battle：一般戰鬥，118 BPM，貝斯＋琶音＋鼓
//   boss  ：旗艦戰，140 BPM，定音鼓、銅管重擊、合唱鋪底、推進的鼓組；王暴走時加上主旋律與更密的鼓
//   接在音效的總音量後面，所以「靜音」會一起關掉；另外可以單獨關掉音樂
// =====================================================================
const Music = {
  on: true, gain: null, track: null, want: null, step: 0, nextT: 0, timer: null, rage: false, VOL: 0.55,
  TRACKS: {
    calm:   { bpm: 80,  bars: [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]], barSteps: 32 },  // Dm Bb F C（每和弦 2 小節）
    battle: { bpm: 118, bars: [[62, 65, 69], [58, 62, 65], [60, 64, 67], [62, 65, 69]], barSteps: 16 },  // Dm Bb C Dm
    boss:   { bpm: 132, bars: [[62, 65, 69], [58, 62, 65], [55, 58, 62], [57, 61, 64]], barSteps: 16 },  // Dm Bb Gm A（A 大三和弦製造緊張感）
  },
  init() {
    const c = SFX.ctx;
    if (!c || this.gain) return;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.gain.connect(SFX.master);
    // 殘響（大廳效果）：用衰減的雜訊產生脈衝響應，王戰的合唱、銅管、定音鼓送一部分進來
    try {
      const len = Math.floor(c.sampleRate * 2.8), ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      this.verb = c.createConvolver(); this.verb.buffer = ir;
      const wet = c.createGain(); wet.gain.value = 0.35;
      this.verb.connect(wet); wet.connect(this.gain);
    } catch (e) { this.verb = null; }
    this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 50);
  },
  toggle() {
    this.on = !this.on;
    Save.setFlag('music', this.on);
    this.fadeTo(this.on && this.track ? 1 : 0, 0.3);
  },
  fadeTo(v, sec) {
    if (!this.gain) return;
    const g = this.gain.gain, t = SFX.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v * this.VOL * Settings.musicVol, t + sec);
  },
  applyVolume() { this.fadeTo(this.on && this.track ? 1 : 0, 0.1); },  // 音樂音量（設定頁）
  // 每一幀依遊戲狀態決定要播哪首；換曲時先淡出再換
  update() {
    if (!this.gain) return;
    const boss = Game.inArena && Game.enemies.find(e => e.t.boss && !e.dead);
    const want = Game.state === 'dead' ? null
      : Game.inArena ? (boss || (Game.combat && Game.combat.boss) ? 'boss' : 'battle') : 'calm';
    this.rage = !!(boss && boss.enraged);
    if (want === this.want) return;
    this.want = want;
    this.fadeTo(0, 0.5);
    clearTimeout(this.swapT);
    this.swapT = setTimeout(() => {
      this.track = this.want; this.step = 0; this.nextT = SFX.ctx.currentTime + 0.05;
      if (this.track && this.on) this.fadeTo(1, 0.8);
    }, 550);
  },
  tick() {
    const c = SFX.ctx;
    if (!c || !this.track || !this.on || c.state !== 'running') { if (c) this.nextT = Math.max(this.nextT, c.currentTime + 0.05); return; }
    const T = this.TRACKS[this.track], dt = 60 / T.bpm / 4;  // 16 分音符
    while (this.nextT < c.currentTime + 0.25) {
      this[this.track](this.step, this.nextT, T, dt);
      this.nextT += dt; this.step++;
    }
  },
  // ---------- 音色 ----------
  hz: m => 440 * Math.pow(2, (m - 69) / 12),
  // rev：送進殘響的比例（0 = 不送）
  note(type, m, t, dur, vol, { attack = 0.01, cutoff = 0, detune = 0, q = 1, rev = 0 } = {}) {
    const c = SFX.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = this.hz(m); o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.02));
    let out = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = q; o.connect(f); out = f; }
    out.connect(g); g.connect(this.gain);
    this.send(g, rev);
    o.start(t); o.stop(t + Math.max(dur, attack + 0.02) + 0.05);
  },
  send(node, rev) {
    if (!rev || !this.verb) return;
    const s = SFX.ctx.createGain(); s.gain.value = rev;
    node.connect(s); s.connect(this.verb);
  },
  drum(kind, t, vol, rev = 0) {
    const c = SFX.ctx, g = c.createGain();
    g.connect(this.gain); this.send(g, rev);
    // 低頻下滑的正弦波：大鼓、定音鼓、太鼓（tom）
    const SW = { kick: [150, 45, 0.14, 0.2], timpani: [110, 38, 0.6, 0.9], tom: [120, 62, 0.25, 0.45], taiko: [80, 40, 0.35, 0.7] }[kind];
    if (SW) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(SW[0], t); o.frequency.exponentialRampToValueAtTime(SW[1], t + SW[2]);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + SW[3]);
      o.connect(g); o.start(t); o.stop(t + SW[3] + 0.05);
      return;
    }
    // 雜訊類：踩鈸、小鼓、大鈸（crash）
    const N = { hat: ['highpass', 7000, 0.04], snare: ['bandpass', 1800, 0.16], crash: ['highpass', 4000, 1.6] }[kind];
    const s = c.createBufferSource(), f = c.createBiquadFilter();
    s.buffer = SFX.noise; s.loop = kind === 'crash';
    f.type = N[0]; f.frequency.value = N[1];
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + N[2]);
    s.connect(f); f.connect(g); s.start(t); s.stop(t + N[2] + 0.02);
  },
  chordOf(T, s) { return T.bars[Math.floor(s / T.barSteps) % T.bars.length]; },
  // ---------- 三首曲子：每個 16 分音符呼叫一次 ----------
  calm(s, t, T, dt) {
    const ch = this.chordOf(T, s), i = s % T.barSteps;
    if (i === 0) for (const m of ch) this.note('triangle', m - 12, t, dt * T.barSteps * 1.05, 0.05, { attack: 1.2 });  // 鋪底
    if (s % 2 === 0) {  // 8 分音符琶音：和弦音往上爬再下來
      const seq = [0, 1, 2, 3, 2, 1], k = seq[(s / 2) % seq.length], m = ch[k % 3] + (k >= 3 ? 12 : 0) + 12;
      this.note('sine', m, t, dt * 3, 0.035, { attack: 0.02 });
    }
  },
  battle(s, t, T, dt) {
    const ch = this.chordOf(T, s), i = s % 16;
    if (i % 4 === 0) this.drum('kick', t, 0.5);
    if (i === 4 || i === 12) this.drum('snare', t, 0.18);
    if (i % 2 === 1) this.drum('hat', t, 0.06);
    if (i % 2 === 0) this.note('sawtooth', ch[0] - 24 + (i % 8 === 6 ? 12 : 0), t, dt * 1.8, 0.09, { cutoff: 500 });  // 貝斯
    const arp = [0, 1, 2, 1], m = ch[arp[i % 4]] + (i >= 8 ? 12 : 0);
    this.note('triangle', m, t, dt * 1.5, 0.03);
    if (i === 0) for (const n of ch) this.note('sawtooth', n - 12, t, dt * 16, 0.015, { attack: 0.3, cutoff: 900 });
  },
  // 旗艦戰：前 2 小節只有太鼓＋合唱的前奏，之後全部進來；暴走時旋律升八度加倍、鼓更密
  //   主旋律（銅管）：每個和弦一小節、8 分音符為單位，null = 延長前一個音
  BOSS_MELODY: [
    [62, null, 62, 64, 65, null, 64, 62],    // Dm
    [58, null, 62, 65, 65, null, 64, 62],    // B♭
    [58, null, 55, 58, 62, null, 60, 58],    // Gm
    [57, null, 61, 64, 69, null, 64, 61],    // A
  ],
  boss(s, t, T, dt) {
    const ch = this.chordOf(T, s), i = s % 16, bar = Math.floor(s / 16), r = this.rage, intro = bar < 2;
    // ---- 打擊：定音鼓、太鼓、大鼓、小鼓、踩鈸、大鈸 ----
    if (i === 0) this.drum('timpani', t, 0.75, 0.5);
    if (bar % 4 === 0 && i === 0 && !intro) this.drum('crash', t, 0.12, 0.4);
    if ([0, 3, 6, 10].includes(i)) this.drum('taiko', t, intro ? 0.45 : 0.6, 0.35);
    if ([7, 11, 14, 15].includes(i)) this.drum('tom', t, 0.35, 0.3);
    if (!intro) {
      if ([0, 8].includes(i) || (r && [3, 11].includes(i))) this.drum('kick', t, 0.5);
      if (i === 4 || i === 12) this.drum('snare', t, 0.28, 0.25);
      if (r || i % 2 === 0) this.drum('hat', t, r ? 0.05 : 0.035);
      if (bar % 2 === 1 && i >= 12) this.drum('snare', t, 0.1 + (i - 12) * (r ? 0.06 : 0.035));  // 小節尾巴的鼓滾
    }
    // ---- 合唱：每小節一個長和弦，4 個聲部（和弦＋低八度根音），大量殘響 ----
    if (i === 0) {
      for (const n of [ch[0] - 12, ...ch]) for (const d of [-10, 10])
        this.note('sawtooth', n, t, dt * 16.5, intro ? 0.016 : 0.012, { cutoff: 900, detune: d, attack: 0.35, rev: 0.8 });
    }
    if (intro) return;
    // ---- 低音：16 分音符的根音脈動（八度跳動） ----
    this.note('sawtooth', ch[0] - 24 + (i % 4 === 2 ? 12 : 0), t, dt * 0.85, 0.075, { cutoff: 420, q: 5 });
    // ---- 弦樂頑固音型：16 分音符在和弦音之間跳動 ----
    const ost = [0, 2, 1, 2], so = ch[ost[i % 4]] + (i >= 8 ? 12 : 0);
    this.note('sawtooth', so, t, dt * 0.7, 0.018, { cutoff: 2200, rev: 0.2 });
    // ---- 銅管主旋律：8 分音符，三個走音的鋸齒波疊成銅管感 ----
    if (i % 2 === 0) {
      const mel = this.BOSS_MELODY[Math.floor(s / 16) % 4], k = i / 2, m = mel[k];
      if (m != null) {
        let len = 1; while (k + len < 8 && mel[k + len] == null) len++;
        for (const d of [-7, 0, 7]) this.note('sawtooth', m, t, dt * 2 * len * 0.95, 0.028, { cutoff: 1600, detune: d, attack: 0.04, rev: 0.45 });
        if (r) this.note('square', m + 12, t, dt * 2 * len * 0.9, 0.022, { cutoff: 3000, rev: 0.3 });  // 暴走：高八度加倍
      }
    }
    // ---- 銅管重擊：每小節第 1、第 4 拍的後半拍 ----
    if (i === 0 || i === 14) for (const n of ch) this.note('sawtooth', n - 12, t, dt * 2.5, 0.03, { cutoff: 1200, detune: 6, attack: 0.015, rev: 0.4 });
  },
};
if (!Save.flag('music', true)) Music.on = false;  // 載入時就讀，標題畫面的按鈕才不會先顯示「開」

addEventListener('pointerdown', () => SFX.init(), { capture: true });
addEventListener('keydown', e => {
  SFX.init();
  if (e.key.toLowerCase() === 'm' && !e.repeat) SFX.setMuted(!SFX.muted);
}, { capture: true });
