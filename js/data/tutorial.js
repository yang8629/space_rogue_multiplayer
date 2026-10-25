// 星環電路 多人版 · tutorial.js：新手引導的每一步：屬於哪一段、畫面上的目標文字（行為在 game/tutorial.js 的 TUTORIAL_PLAY）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// sec = 段名（畫面上「第幾段 / 共幾段」照段名數）；goal = 這一步要做的事（數字從 CFG.TUTORIAL、武器、晶片表產生）
const TUTORIAL = [
  { id: 'move', sec: '移動', goal: () => `WASD 移動：飛進綠色光圈（${CFG.TUTORIAL.points.length} 個）` },
  { id: 'dash', sec: '移動', goal: () => `Space 衝刺 ${CFG.TUTORIAL.dashes} 次` },
  { id: 'shoot', sec: '射擊', goal: () => `按住左鍵射擊：打掉 ${CFG.TUTORIAL.shootN} 隻${ENEMY_TYPES.swarmer.name}` },
  { id: 'vent', sec: '排熱', goal: () => `連續射擊讓熱度到 ${pct(HEAT.min)} 以上，按右鍵${WEAPONS.laser.alt.name}` },
  { id: 'chip', sec: '晶片', goal: () => `按 Tab 打開電路，把倉庫的「${CHIPS[CFG.TUTORIAL.chip].name}」拖到飛船後面的空格，再按 Tab 關掉` },
  { id: 'trigger', sec: '晶片', goal: () => `射擊標靶：打中會觸發${CHIPS[CFG.TUTORIAL.chip].name}` },
  { id: 'plug', sec: '晶片', goal: () => `按 Tab，把「${CHIPS[CFG.TUTORIAL.plug].name}」拖到${CHIPS[CFG.TUTORIAL.chip].name}的插座上` },
  { id: 'fight', sec: '實戰', goal: () => '打掉所有敵人' },
  { id: 'elite', sec: '實戰', goal: () => `打掉精英「${ENEMY_TYPES[CFG.TUTORIAL.elite].name}」` },
];
const TUTORIAL_SECS = [...new Set(TUTORIAL.map(s => s.sec))];
