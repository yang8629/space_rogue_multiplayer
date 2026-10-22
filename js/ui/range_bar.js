// 星環電路 多人版 · range_bar.js：靶場戰鬥中畫面上方的按鈕列（1～5、R、T、生成敵人）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   只在靶場戰鬥中顯示；目前的排列／實戰／慢動作亮起來。按下去呼叫 Range 的方法（Range.key、spawnAt、setSpawn）
'use strict';

const RangeBar = {
  el: null,
  sync() {  // 每幀（core/main.js）
    if (!this.el) {
      this.el = document.getElementById('rangeBar');
      if (!this.el) return;
      this.el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-rk]');
        if (!b) return;
        if (b.dataset.rk === 'g') Range.spawnAt(1, false);  // 按鈕：生在飛船前方（滑鼠在按鈕上）
        else Range.key(b.dataset.rk);
        b.blur();
      });
      const ty = document.getElementById('rgType'), lv = document.getElementById('rgLv');
      if (ty && lv) {
        ty.innerHTML = Range.spawnTypes().map(k => `<option value="${k}">${ENEMY_TYPES[k].name}${ENEMY_TYPES[k].boss ? '（王）' : ''}</option>`).join('');
        lv.innerHTML = Range.SPAWN_LV.map(l => `<option value="${l}">難度 ${l}</option>`).join('');
        ty.value = Range.spawnType; lv.value = String(Range.spawnLv);
        ty.addEventListener('change', () => { Range.setSpawn(ty.value, null); ty.blur(); });  // 選完就離開選單（不然按鍵會改到選項）
        lv.addEventListener('change', () => { Range.setSpawn(null, +lv.value); lv.blur(); });
      }
    }
    const show = Game.mode === 'range' && Game.state === 'play';
    this.el.classList.toggle('hidden', !show);
    if (!show) return;
    for (const b of this.el.querySelectorAll('[data-rk="move"]')) b.textContent = Range.spawnMove ? '會動' : '不動';
    for (const b of this.el.querySelectorAll('[data-rk="kill"]')) b.textContent = Range.spawnKill ? '打得死' : '打不死';
    const cur = Range.live ? '5' : Range.KEY_CH[Range.KEYS.indexOf(Range.layout)];
    for (const b of this.el.querySelectorAll('[data-rk]'))
      b.classList.toggle('on', b.dataset.rk === cur || (b.dataset.rk === 't' && Range.slow));
  },
};
