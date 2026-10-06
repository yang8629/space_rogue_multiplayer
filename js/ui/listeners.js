// 星環電路 雙人版 · listeners.js：聽遊戲邏輯發出的事件（Events），播音效、切換畫面
// 事件名稱和帶的資料見各個 Events.emit；這裡決定「發生這件事時要怎麼表現」
'use strict';

// ---------- 畫面：Game.view() 照目前的 state 發出 'view'，這裡決定畫哪一頁 ----------
{
  const VIEWS = {
    title: () => Screen.title(),
    map: m => Screen.map(m),
    reward: () => Screen.reward(),
    shop: m => Screen.shop(m),
    blackhole: () => Screen.blackhole(),
    armory: () => Screen.armory(Game.armorySource || 'armory'),
    workshop: () => Screen.workshop(),
    victory: () => Screen.victory(),
    dead: () => Screen.dead(),
    ended: () => Screen.ended(),
    play: () => { if (Game.pauseMenu) Screen.pauseMenu(); else Screen.hide(); },  // 戰鬥中：Esc 選單
  };
  Events.on('view', d => (VIEWS[d.state] || (() => Screen.hide()))(d.msg));
  Events.on('died', () => setTimeout(() => { if (Game.state === 'dead') Screen.dead(); }, 900));  // 先看一下爆炸再顯示結算
  Events.on('combatWon', () => { Screen.clickLock = performance.now() + 600; });  // 戰鬥中連點射擊：勝利／三選一畫面剛出現 0.6 秒內不接受點擊（免得直接按到按鈕）
  Events.on('editor', d => { if (d.open) Editor.open(); else Editor.close(); });
  Events.on('editorMsg', d => {
    if (d.hint === 'newChip') Editor.infoEl.innerHTML = `<b style="color:#9dff6b">${d.msg}</b><br>新晶片在下方倉庫：拖到上方電路（或點一下再點插槽）就能裝上。按 Tab 或「返回」回到航圖。`;
  });
}

{
  const S = (ev, name) => Events.on(ev, () => SFX.play(name));
  S('dash', 'dash');
  S('overheat', 'hurt');
  S('enemyShot', 'eshot');
  S('bossSkill', 'boss');
  S('bossArrive', 'boss');
  S('cometIncoming', 'boss');
  S('areaClear', 'clear');
  S('revive', 'clear');
  S('upgrade', 'upgrade');
  S('fuseStart', 'fusing');
  S('hit', 'hit');
  S('explode', 'explode');
  S('pickup', 'pickup');
  S('nudge', 'click');
  Events.on('shoot', d => SFX.play('shoot', d.weapon));
  Events.on('waveStart', d => SFX.play(d.boss ? 'boss' : 'wave'));
  Events.on('fuseEnd', d => SFX.play(d.good ? 'fuseok' : 'fusefail'));
  Events.on('enemyKilled', d => SFX.play(d.e.t.boss ? 'bossdeath' : d.big ? 'bigkill' : 'kill'));
  Events.on('playerHurt', d => SFX.play(d.dead ? 'death' : 'hurt'));
  Events.on('objBreak', d => SFX.play(d.big ? 'bigkill' : 'explode'));  // 行星、小行星、彗星被打爆
}
