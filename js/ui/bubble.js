// 星環電路 多人版 · bubble.js：新手教學的泡泡框：指著三選一的卡片、電路畫面倉庫裡的東西、戰場上的位置說明一件事
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   要跳哪一個問 Tutorial.tipNow()；點畫面任何地方換下一個（Tutorial.nextTip），stay 的不用點、做到那一步才收
//   跳的時候其他地方壓暗，只留指著的東西亮著（spot 的大陰影蓋住整個畫面）
'use strict';

const Bubble = {
  el: null, cover: null, spot: null, settle: 0, timer: 0,
  init() {
    this.spot = document.createElement('div'); this.spot.className = 'bb-spot hidden';
    this.cover = document.createElement('div'); this.cover.className = 'bb-cover hidden';
    this.el = document.createElement('div'); this.el.className = 'bubble hidden';
    document.body.append(this.spot, this.cover, this.el);
    // 點畫面：換下一個（蓋一層透明的，點不到底下的按鈕：說明完才能選）
    this.cover.addEventListener('click', () => { SFX.play('click'); Tutorial.nextTip(); this.sync(); });
    addEventListener('resize', () => this.sync());
  },
  // 指著的地方（螢幕上的矩形）：三選一第 i 張卡片、電路畫面倉庫裡的 item（拖走了就收起來）、戰場上的位置
  rect(t) {
    if (t.at === 'card') { const el = Game.state === 'reward' && Screen.el.querySelectorAll('.cards > .card')[t.i]; return el ? el.getBoundingClientRect() : null; }
    if (t.at === 'inv' && Game.state === 'editor') {
      const k = Game.inventory.findIndex(id => id && baseOf(id) === t.item);
      return k >= 0 ? Editor.invEl.children[k].getBoundingClientRect() : null;
    }
    if (t.at === 'hud' && HUD_AT[t.item] && Game.state === 'play') {
      const c = canvas.getBoundingClientRect(), h = HUD_AT[t.item];
      return { left: c.left + h.x, top: c.top + h.y, right: c.left + h.x + h.w, bottom: c.top + h.y + h.h, width: h.w, height: h.h };
    }
    if (t.at === 'cue' && t.pos && Game.state === 'play') {
      const c = canvas.getBoundingClientRect(), r = (t.pos.r + 14) * ZOOM, x = c.left + (t.pos.x - Game.cam.x) * ZOOM, y = c.top + (t.pos.y - Game.cam.y) * ZOOM;
      return { left: x - r, top: y - r, right: x + r, bottom: y + r, width: 2 * r, height: 2 * r, round: true };
    }
    return null;
  },
  // 三選一的卡片還在翻（或剛翻完不到 BEAT 毫秒）：先不跳，等一下再看（翻到一半時卡片很窄，亮的範圍會變成一條）
  BEAT: 300,
  busy(t) {
    if (t.at !== 'card' || Game.state !== 'reward') return false;
    const box = Screen.el.querySelector('.cards'), anims = box && box.getAnimations ? box.getAnimations({ subtree: true }) : [];
    const moving = Array.isArray(anims) && (box.classList.contains('flip-hold') || anims.some(a => a.playState === 'running'));  // 只認真的瀏覽器（測試的假 DOM 拿不到動畫清單）
    const now = performance.now();
    if (moving) this.settle = now;
    if (!moving && now - this.settle >= this.BEAT) return false;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), moving ? 100 : this.BEAT - (now - this.settle));
    return true;
  },
  sync() {
    if (!this.el) this.init();
    const t = Game.mode === 'tutorial' ? Tutorial.tipNow() : null, r = t && !this.busy(t) && this.rect(t);
    this.cover.classList.toggle('hidden', !r || t.stay);
    this.el.classList.toggle('hidden', !r);
    this.spot.classList.toggle('hidden', !r);
    if (!r) return;
    const P = 6;  // 亮著的範圍比指著的東西大一點
    Object.assign(this.spot.style, { left: r.left - P + 'px', top: r.top - P + 'px', width: r.width + 2 * P + 'px', height: r.height + 2 * P + 'px', borderRadius: r.round ? '50%' : '8px' });
    this.el.innerHTML = `<div class="bb-ttl">${t.title}</div><div class="bb-txt">${t.text}</div>${t.stay ? '' : '<div class="bb-next">點畫面繼續</div>'}`;
    // 放在東西上面（上面放不下就放下面），箭頭指著它的中間；左右不超出畫面
    const b = this.el.getBoundingClientRect(), up = r.top - b.height - 16 >= 8;
    const left = clamp(r.left + r.width / 2 - b.width / 2, 8, innerWidth - b.width - 8);
    this.el.style.left = left + 'px';
    this.el.style.top = (up ? r.top - P - b.height - 16 : r.bottom + P + 16) + 'px';
    this.el.classList.toggle('below', !up);
    this.el.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
  },
};
