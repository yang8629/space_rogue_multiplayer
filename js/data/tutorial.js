// 星環電路 多人版 · tutorial.js：新手教學的每一步：屬於哪一段、畫面上的目標文字、泡泡框（行為在 game/tutorial.js 的 TUTORIAL_PLAY）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 泡泡框說明的名詞（三選一卡片、電路畫面的倉庫上跳出來）
const TUTORIAL_TERMS = {
  chip: { title: '晶片', text: () => '接在電路上；武器打中敵人時放出自己的攻擊，也會觸發下一片晶片' },
  plug: { title: '插件', text: () => '插在晶片下面的插座上；效果傳給這片和它後面所有晶片' },
  part: { title: '零件', text: () => '改機體數值：每層一個好處、一個代價；同種疊 2、4 層開特性' },  // 層數照 PARTS 的 t2、t4
};
// sec = 段名（畫面上「第幾段 / 共幾段」照段名數）；goal = 這一步要做的事（數字從 CFG.TUTORIAL、武器、晶片表產生）
// tips = 這一步依序跳出的泡泡框：term = TUTORIAL_TERMS 的哪個（或自己寫 title、text）；at = 指著哪裡（card：三選一第 i 張、inv：電路畫面倉庫裡的 item、hud：戰鬥畫面左上角的哪一列、cue：戰場上那個位置）
//   點畫面換下一個；stay = 不用點、一直留著（做到這一步才收）；cue = 等這一步說「發生了」（迴旋刃打到後排、後排燒起來）才跳；戰鬥中跳的（hud、cue）戰場停住
const TUTORIAL = [
  { id: 'move', sec: '移動', goal: () => `WASD 移動、Space 衝刺：飛進綠色光圈，衝刺 ${CFG.TUTORIAL.dashes} 次` },
  { id: 'shoot', sec: '射擊', goal: () => `按住左鍵射擊：打掉 ${CFG.TUTORIAL.shootN} 隻${ENEMY_TYPES.swarmer.name}` },
  { id: 'vent', sec: '排熱', goal: () => `被包圍了：射擊讓熱度到 ${pct(HEAT.min)} 以上，按右鍵${WEAPONS.laser.alt.name}，一次打掉一圈`,
    tips: [{ at: 'hud', item: () => 'heat', title: () => '熱度', text: () => `左上角這條：每發 +${pct(HEAT.per)}，滿了過熱停火 ${HEAT.lock} 秒；${pct(HEAT.min)} 以上可以按右鍵${WEAPONS.laser.alt.name}，熱度越高衝擊波越痛` }] },
  { id: 'reward', sec: '三選一', goal: () => `三選一：這次選晶片「${CHIPS[CFG.TUTORIAL.chip].name}」`,
    tips: [{ term: 'chip', at: 'card', i: 0 }, { term: 'plug', at: 'card', i: 1 }, { term: 'part', at: 'card', i: 2 },
      { title: '選這張', text: () => `這次先拿晶片「${CHIPS[CFG.TUTORIAL.chip].name}」：選了會自動接上電路`, at: 'card', i: 0, stay: true }] },
  { id: 'trigger', sec: '晶片', goal: () => `前排的${ENEMY_TYPES[CFG.TUTORIAL.row.front].name}打不死：打它，用${CHIPS[CFG.TUTORIAL.chip].name}打掉後排 ${CFG.TUTORIAL.row.n} 隻`,
    tips: [{ cue: true, at: 'cue', title: () => CHIPS[CFG.TUTORIAL.chip].name, text: () => '光束打中前排時放出迴旋刃：從打中的地方往前飛，打到後排，再飛回飛船' }] },
  { id: 'plug', sec: '晶片', goal: () => `按 Tab，把倉庫的「${CHIPS[CFG.TUTORIAL.plug].name}」拖到${CHIPS[CFG.TUTORIAL.chip].name}的插座上，再按 Tab 關掉`,
    tips: [{ term: 'plug', at: 'inv', item: () => CFG.TUTORIAL.plug }] },
  { id: 'burn', sec: '晶片', goal: () => `再打前排：迴旋刃帶著${CHIPS[CFG.TUTORIAL.plug].name}，燒掉後排 ${CFG.TUTORIAL.row.n} 隻`,
    tips: [{ cue: true, at: 'cue', title: () => '燃燒', text: () => `${CHIPS[CFG.TUTORIAL.plug].name}插在${CHIPS[CFG.TUTORIAL.chip].name}上：迴旋刃打中的敵人燒起來，持續扣血` }] },
  { id: 'fight', sec: '實戰', goal: () => '打掉所有敵人' },
  { id: 'elite', sec: '實戰', goal: () => `打掉精英「${ENEMY_TYPES[CFG.TUTORIAL.elite].name}」` },
];
const TUTORIAL_SECS = [...new Set(TUTORIAL.map(s => s.sec))];
