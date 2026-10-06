// 星環電路 雙人版 · events.js：事件
// 遊戲邏輯只發出「發生了什麼」（Events.emit），音效、畫面、特效各自登記要聽哪些（Events.on，見 ui/listeners.js）
//   邏輯不直接呼叫音效、畫面：搬到別的引擎時，只要換掉聽的那一頭（像 Godot 的 signal）
'use strict';

const Events = {
  map: new Map(),
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
  },
  emit(name, data) {
    const L = this.map.get(name);
    if (L) for (const fn of L) fn(data);
  },
};
