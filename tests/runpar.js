'use strict';
// 同時跑好幾個 node 程式（release.js 用）：最多 4 個一起跑（CPU 太熱的上限），跑完印 JSON：[{ label, status, out, sec }]（順序照給的）
//   用法：node runpar.js '[["名稱", ["檔案.js", "參數"]], ...]'
const { spawn } = require('child_process');
const jobs = JSON.parse(process.argv[2] || '[]'), res = new Array(jobs.length), MAX = 4;
let next = 0, live = 0;
const start = () => {
  while (live < MAX && next < jobs.length) {
    const i = next++, [label, argv] = jobs[i], t = Date.now(), p = spawn(process.execPath, argv, { cwd: __dirname });
    let out = '';
    live++;
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', status => {
      res[i] = { label, status, out, sec: (Date.now() - t) / 1000 };
      live--;
      if (next < jobs.length) start(); else if (!live) process.stdout.write(JSON.stringify(res));
    });
  }
};
if (jobs.length) start(); else process.stdout.write('[]');
