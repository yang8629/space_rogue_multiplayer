// 星環電路 雙人版 · listeners.js：聽遊戲邏輯發出的事件（Events），播音效
// 事件名稱和帶的資料見各個 Events.emit；這裡決定「發生這件事時要怎麼表現」
'use strict';

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
