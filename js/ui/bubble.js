// 星環電路 多人版 · bubble.js：新手引導的泡泡框：指著三選一的卡片、電路畫面倉庫裡的東西說明一個名詞
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   要跳哪一個問 Tutorial.tipNow()；點畫面任何地方換下一個（Tutorial.nextTip），stay 的不用點、做到那一步才收
'use strict';

const Bubble = {
  el: null, cover: null,
  init() {
    this.cover = document.createElement('div'); this.cover.className = 'bb-cover hidden';
    this.el = document.createElement('div'); this.el.className = 'bubble hidden';
    document.body.append(this.cover, this.el);
    // 點畫面：換下一個（蓋一層透明的，點不到底下的按鈕：說明完才能選）
    this.cover.addEventListener('click', () => { SFX.play('click'); Tutorial.nextTip(); this.sync(); });
    addEventListener('resize', () => this.sync());
  },
  // 指著的東西：三選一第 i 張卡片、電路畫面倉庫裡的 item（拖走了就收起來）
  target(t) {
    if (t.at === 'card') return Game.state === 'reward' ? Screen.el.querySelectorAll('.cards > .card')[t.i] : null;
    if (t.at === 'inv' && Game.state === 'editor') {
      const k = Game.inventory.findIndex(id => id && baseOf(id) === t.item);
      return k >= 0 ? Editor.invEl.children[k] : null;
    }
    return null;
  },
  sync() {
    if (!this.el) this.init();
    const t = Game.mode === 'tutorial' ? Tutorial.tipNow() : null, tg = t && this.target(t);
    this.cover.classList.toggle('hidden', !tg || t.stay);
    this.el.classList.toggle('hidden', !tg);
    if (!tg) return;
    this.el.innerHTML = `<div class="bb-ttl">${t.title}</div><div class="bb-txt">${t.text}</div>${t.stay ? '' : '<div class="bb-next">點畫面繼續</div>'}`;
    // 放在東西上面（上面放不下就放下面），箭頭指著它的中間；左右不超出畫面
    const r = tg.getBoundingClientRect(), b = this.el.getBoundingClientRect(), up = r.top - b.height - 16 >= 8;
    const left = clamp(r.left + r.width / 2 - b.width / 2, 8, innerWidth - b.width - 8);
    this.el.style.left = left + 'px';
    this.el.style.top = (up ? r.top - b.height - 16 : r.bottom + 16) + 'px';
    this.el.classList.toggle('below', !up);
    this.el.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
  },
};
