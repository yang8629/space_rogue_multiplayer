// 星環電路 雙人版 · audio.js：音效 SFX、背景音樂 Music（Web Audio 即時合成）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SFX — Web Audio 即時合成音效（不需要音檔）
//   瀏覽器規定要使用者互動後才能發聲，所以在第一次點擊或按鍵時 init
//   同一種聲音有最短間隔（gap），避免高射速時變成噪音
// =====================================================================
const SFX = {
  ctx: null, master: null, noise: null, muted: false, last: {},
  VOLUME: 0.35,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.VOLUME;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.6, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { this.ctx = null; }
    Music.init();
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.VOLUME;
    try { localStorage.setItem('muted', m ? '1' : '0'); } catch (e) {}
    document.querySelectorAll('[data-act="mute"]').forEach(b => b.textContent = m ? '🔇 音效關' : '🔊 音效開');
  },
  ready(key, gap) {
    if (!this.ctx || this.muted) return false;
    const t = performance.now();
    if (this.last[key] && t - this.last[key] < gap) return false;
    this.last[key] = t;
    return true;
  },
  tone({ type = 'square', f = 440, f2 = 0, dur = 0.1, vol = 0.2, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  hiss({ dur = 0.15, vol = 0.2, freq = 1200, f2 = 0, filter = 'lowpass', q = 1, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  },
  arp(notes, type = 'sine', step = 0.08, vol = 0.12) {
    notes.forEach((f, i) => this.tone({ type, f, dur: 0.18, vol, delay: i * step }));
  },
  play(name, arg) {
    // 房主的戰場音效轉給隊友（受傷、衝刺、介面音效各自在自己的電腦播）
    if (Net.role === 'host' && !['hurt', 'death', 'dash', 'click', 'upgrade'].includes(name)) Net.fx(['s', name, arg]);
    if (!this.ctx || this.muted) return;  // 音效還沒啟動（或瀏覽器不支援）時直接略過，不能讓遊戲當掉
    const T = (o) => this.tone(o), H = (o) => this.hiss(o);
    switch (name) {
      case 'shoot':
        if (arg === 'laser' && this.ready('shoot', 45)) T({ f: 1400, f2: 600, dur: 0.06, vol: 0.06 });
        if (arg === 'scatter' && this.ready('shoot', 60)) { H({ freq: 3000, f2: 400, dur: 0.12, vol: 0.18 }); T({ type: 'sine', f: 160, f2: 60, dur: 0.1, vol: 0.12 }); }
        if (arg === 'plasma' && this.ready('shoot', 80)) T({ type: 'sine', f: 320, f2: 90, dur: 0.25, vol: 0.18 });
        if (arg === 'railgun' && this.ready('shoot', 50)) { H({ freq: 5000, filter: 'highpass', dur: 0.08, vol: 0.18 }); T({ type: 'sawtooth', f: 900, f2: 120, dur: 0.18, vol: 0.08 }); }
        if (arg === 'blade' && this.ready('shoot', 60)) H({ freq: 2600, f2: 800, filter: 'bandpass', q: 2, dur: 0.12, vol: 0.2 });
        break;
      case 'ricochet': if (this.ready('ricochet', 50)) T({ type: 'triangle', f: 1600, f2: 2400, dur: 0.05, vol: 0.06 }); break;
      case 'hit': if (this.ready('hit', 35)) T({ type: 'triangle', f: 500 + Math.random() * 200, f2: 250, dur: 0.04, vol: 0.05 }); break;
      case 'kill': if (this.ready('kill', 30)) T({ f: 520, f2: 110, dur: 0.1, vol: 0.07 }); break;
      case 'bigkill': if (this.ready('bigkill', 80)) { H({ freq: 900, f2: 90, dur: 0.5, vol: 0.35 }); T({ type: 'sine', f: 130, f2: 40, dur: 0.5, vol: 0.25 }); } break;
      case 'bossdeath': H({ freq: 1200, f2: 60, dur: 1.4, vol: 0.5 }); T({ type: 'sawtooth', f: 200, f2: 30, dur: 1.4, vol: 0.2 }); this.arp([523, 659, 784, 1047], 'triangle', 0.12, 0.1); break;
      case 'explode': if (this.ready('explode', 60)) H({ freq: 1400, f2: 150, dur: 0.3, vol: 0.2 }); break;
      case 'eshot': if (this.ready('eshot', 90)) T({ f: 700, f2: 480, dur: 0.05, vol: 0.035 }); break;
      case 'hurt': T({ type: 'sawtooth', f: 240, f2: 70, dur: 0.25, vol: 0.22 }); H({ freq: 800, dur: 0.15, vol: 0.15 }); break;
      case 'death': T({ type: 'sawtooth', f: 400, f2: 40, dur: 1.2, vol: 0.25 }); H({ freq: 1000, f2: 80, dur: 1.2, vol: 0.35 }); break;
      case 'dash': if (this.ready('dash', 80)) H({ freq: 500, f2: 2600, filter: 'bandpass', q: 1.5, dur: 0.16, vol: 0.14 }); break;
      case 'shock': H({ freq: 500, f2: 80, dur: 0.35, vol: 0.3 }); T({ type: 'sine', f: 110, f2: 40, dur: 0.3, vol: 0.25 }); break;
      case 'pickup': if (this.ready('pickup', 40)) T({ type: 'sine', f: 1200 + Math.random() * 300, f2: 1900, dur: 0.05, vol: 0.05 }); break;
      case 'wave': T({ f: 440, dur: 0.1, vol: 0.08 }); T({ f: 660, dur: 0.14, vol: 0.08, delay: 0.1 }); break;
      case 'boss': T({ type: 'sawtooth', f: 90, f2: 45, dur: 1.4, vol: 0.28 }); H({ freq: 300, dur: 1.4, vol: 0.25 }); break;
      case 'clear': this.arp([523, 659, 784], 'triangle', 0.09, 0.1); break;
      case 'click': if (this.ready('click', 40)) T({ type: 'triangle', f: 820, dur: 0.04, vol: 0.07 }); break;
      case 'upgrade': this.arp([523, 659, 784, 1047], 'sine', 0.07, 0.13); break;
      case 'fuseok': this.arp([392, 523, 659, 784, 1047], 'triangle', 0.09, 0.13); break;
      case 'fusefail': T({ type: 'sawtooth', f: 300, f2: 50, dur: 0.7, vol: 0.2 }); H({ freq: 600, f2: 100, dur: 0.6, vol: 0.25 }); break;
      case 'fusing': T({ type: 'sine', f: 60, f2: 400, dur: 1.1, vol: 0.2 }); H({ freq: 200, f2: 2000, filter: 'bandpass', dur: 1.1, vol: 0.15 }); break;
    }
  },
};
try { if (localStorage.getItem('muted') === '1') SFX.muted = true; } catch (e) {}

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
    try { localStorage.setItem('music', this.on ? '1' : '0'); } catch (e) {}
    this.fadeTo(this.on && this.track ? 1 : 0, 0.3);
  },
  fadeTo(v, sec) {
    if (!this.gain) return;
    const g = this.gain.gain, t = SFX.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v * this.VOL, t + sec);
  },
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
try { if (localStorage.getItem('music') === '0') Music.on = false; } catch (e) {}  // 載入時就讀，標題畫面的按鈕才不會先顯示「開」

addEventListener('pointerdown', () => SFX.init(), { capture: true });
addEventListener('keydown', e => {
  SFX.init();
  if (e.key.toLowerCase() === 'm' && !e.repeat) SFX.setMuted(!SFX.muted);
}, { capture: true });
