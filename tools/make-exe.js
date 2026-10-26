#!/usr/bin/env node
/**
 * 生成 Windows 单文件 exe（Node SEA）。
 *
 * 前置：npm run sea:blob 已产出 dist/sea-prep.blob
 * 用法：node tools/make-exe.js [--node <path/to/node.exe>]
 *
 * 注意：必须用「真实的 node.exe」，不能用 Volta / nvm 的 shim，
 * 否则注入会失败（shim 只有几 MB，且 PE 资源段不完整）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BLOB = path.join(DIST, 'sea-prep.blob');
const OUT = path.join(DIST, 'dcr.exe');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const argOf = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

function realNodeBinary() {
  const explicit = argOf('node');
  if (explicit) return explicit;
  const { execPath } = process;
  if (fs.statSync(execPath).size < 20 * 1024 * 1024) {
    throw new Error(
      `当前 node 可执行文件过小（${Math.round(fs.statSync(execPath).size / 1024 / 1024)} MB），`
      + '可能是 Volta / nvm 的 shim。请用 --node <真实 node.exe 路径> 指定。'
    );
  }
  return execPath;
}

if (!fs.existsSync(BLOB)) {
  console.error('缺少 dist/sea-prep.blob，先执行 npm run sea:blob');
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.error('该脚本只用于生成 Windows exe');
  process.exit(1);
}

const nodeBin = realNodeBinary();
console.log(`源 node: ${nodeBin} (${Math.round(fs.statSync(nodeBin).size / 1024 / 1024)} MB)`);

fs.copyFileSync(nodeBin, OUT);
console.log(`已复制 -> ${path.relative(ROOT, OUT)}`);

const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
if (!fs.existsSync(postject)) {
  console.error('缺少 postject，先执行 npm i -D postject');
  process.exit(1);
}

console.log('注入 SEA blob ...');
execFileSync(process.execPath, [postject, OUT, 'NODE_SEA_BLOB', BLOB, '--sentinel-fuse', FUSE], {
  stdio: 'inherit'
});

console.log(`\n完成: ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024 / 1024)} MB)`);
console.log('验证: dist\\dcr.exe --version');
