// Local HTTP launchers for completed generation samples; no website changes.
const fs = require('node:fs'), path = require('node:path');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const source = process.argv[3];
if (!report.originalityComparison || !source) throw Error('Supply originality report and existing preview-helper folder.');
for (const file of ['preview-server.cjs','static-preview.cjs']) fs.copyFileSync(path.join(source,file),path.join(report.output,file));
const launcher = fs.readFileSync(path.join(source,'Open-Website.ps1'),'utf8')
  .replaceAll('01-Default','01-MAX-Fresh').replaceAll('02-Medium','02-MAX-Repeat-Brief').replace(",'03-MAX'",'');
fs.writeFileSync(path.join(report.output,'Open-Website.ps1'),launcher);
for (const [file,label] of [['OPEN-FIRST.cmd','01-MAX-Fresh'],['OPEN-SECOND.cmd','02-MAX-Repeat-Brief']]) {
  fs.writeFileSync(path.join(report.output,file),'@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Website.ps1" -Showcase '+label+'\r\n');
}
console.log(report.output);
