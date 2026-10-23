// 晶片價值表（平行跑）：botsim.js --value 拆成「每把武器 × 幾組晶片」同時跑，跑完合併印表
//   --pairs：兩兩組合，拆成「每把武器 ×（空著＋單一晶片 1 份、組合 --groups 份）」
// 用法：node chipvalue.js --n=20 [--pairs] [--groups=4] [--jobs=4] [--save]   其他參數原樣傳給 botsim.js
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const T_ = require('./load_game').loadGame();
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const WPN = arg('w') ? arg('w').split(',') : Object.keys(T_.WEAPONS);  // 照遊戲的武器表（以前寫死改版前的 5 把，少了蜂群）
const CHIPS = arg('chips') ? arg('chips').split(',') : T_.NORMAL_IDS.filter(id => !T_.CHIPS[id].locked && true);  // 跟 botsim --value 一樣（觸發器 2026-10-03 起一起量）
const GROUPS = +(arg('groups') || 4), PAIRS = process.argv.includes('--pairs');
const pass = process.argv.slice(2).filter(a => !/^--(w|chips|groups|jobs|save|update|json)=?/.test(a));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chipvalue-'));
const jobs = [];
for (const w of WPN) {
  if (PAIRS) {
    jobs.push({ w, a: ['--pgroup=s'], file: path.join(dir, `${w}_s.json`) });
    for (let g = 0; g < GROUPS; g++) jobs.push({ w, a: [`--pgroup=${g}/${GROUPS}`, ...(arg('chips') ? [`--chips=${arg('chips')}`] : [])], file: path.join(dir, `${w}_${g}.json`) });
  } else for (let g = 0; g < GROUPS; g++) {
    const cs = CHIPS.filter((_, i) => i % GROUPS === g);
    if (cs.length) jobs.push({ w, a: [`--chips=${cs.join(',')}`], file: path.join(dir, `${w}_${g}.json`) });
  }
}
const t0 = Date.now(), MAXJ = +(arg('jobs') || 4);  // 最多同時跑幾個（太多 CPU 會到 100 度）
let done = 0;
process.stderr.write(`${jobs.length} 份（${WPN.length} 把武器 × ${PAIRS ? `（1 ＋ ${GROUPS}）份` : `${GROUPS} 組晶片`}），最多同時跑 ${MAXJ} 個\n`);
const one = j => new Promise((ok, bad) => {
  const c = spawn(process.execPath, [path.join(__dirname, 'botsim.js'), '--value', `--w=${j.w}`, ...j.a, `--json=${j.file}`, ...pass], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; c.stderr.on('data', d => { err += d; });
  c.on('exit', code => {
    if (code) return bad(new Error(`${j.w} ${j.a.join(' ')} 失敗：\n${err}`));
    process.stderr.write(`  ${++done}/${jobs.length} 完成（${Math.round((Date.now() - t0) / 1000)} 秒）\n`); ok();
  });
});
const queue = jobs.slice(), worker = async () => { while (queue.length) await one(queue.shift()); };
Promise.all(Array.from({ length: Math.min(MAXJ, jobs.length) }, worker)).then(() => {
  const args = [path.join(__dirname, 'botsim.js'), '--value', `--merge=${jobs.map(j => j.file).join(',')}`, ...pass];
  if (process.argv.includes('--save')) args.push('--save');
  if (process.argv.includes('--update')) args.push('--update');
  const c = spawn(process.execPath, args, { stdio: 'inherit' });
  c.on('exit', code => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); });
}, e => { console.error(e.message); process.exit(1); });
