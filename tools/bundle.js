#!/usr/bin/env node
/**
 * 极简 CommonJS 打包器：把 lib/ 与入口合并成一个无外部依赖的 JS 文件。
 *
 * 之所以自己写而不用 esbuild：本项目只有 5 个模块、零第三方依赖，
 * 一个 60 行的拼接器就够了，还省掉 devDependency。
 *
 * 用法: node tools/bundle.js [--out dist/dcr-bundle.js]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENTRY = 'lib/sea-entry.js';

const args = {};
process.argv.slice(2).forEach((token, i, arr) => {
  if (!token.startsWith('--')) return;
  const value = arr[i + 1];
  args[token.slice(2)] = value && !value.startsWith('--') ? value : true;
});

const outFile = path.resolve(ROOT, args.out || 'dist/dcr-bundle.js');

/** 解析相对 require 的模块 id；JSON 保留扩展名 */
function resolveId(fromId, spec) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec));
  if (resolved.endsWith('.json')) return resolved;
  if (resolved.endsWith('.js')) return resolved;
  return `${resolved}.js`;
}

/** 收集入口及其相对依赖 */
function collect(entry) {
  const seen = new Map();
  const walk = (id) => {
    if (seen.has(id)) return;
    const full = path.join(ROOT, id);
    if (!fs.existsSync(full)) throw new Error(`模块不存在: ${full}`);
    const raw = fs.readFileSync(full, 'utf8');
    seen.set(id, id.endsWith('.json') ? `module.exports = ${JSON.stringify(JSON.parse(raw))};` : raw);
    if (id.endsWith('.json')) return;
    const dir = path.posix.dirname(id);
    for (const match of raw.matchAll(/require\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
      walk(resolveId(id, match[2]));
    }
  };
  walk(entry);
  return seen;
}

const modules = collect(ENTRY);

const wrap = (id, code) => {
  // JSON 已在上一步转成 module.exports 语句，这里只需处理相对路径
  const rewritten = code.replace(/require\(\s*(['"])(\.[^'"]*)\1\s*\)/g, (m, q, spec) =>
    `__req(${JSON.stringify(resolveId(id, spec))})`);
  return `__define(${JSON.stringify(id)}, function (module, exports, require) {\n${rewritten}\n});`;
};

const parts = [];
parts.push('// 由 tools/bundle.js 自动生成，请勿手改');
parts.push("'use strict';");
parts.push('const __modules = Object.create(null);');
parts.push('const __cache = Object.create(null);');
parts.push('const __define = (id, fn) => { __modules[id] = fn; };');
parts.push(`const __req = (id) => {
  if (__cache[id]) return __cache[id].exports;
  const fn = __modules[id];
  if (!fn) return require(id);            // 内置模块回落到原生 require
  const mod = (__cache[id] = { exports: {} });
  fn(mod, mod.exports, __req);
  return mod.exports;
};`);

// 内嵌资源：SKILL.md 与版本号，使 exe 不需要外部文件
const skillMd = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
parts.push(`global.__DCR_SKILL_MD__ = ${JSON.stringify(skillMd)};`);
parts.push(`global.__DCR_VERSION__ = ${JSON.stringify(pkg.version)};`);

for (const [id, code] of modules) parts.push(wrap(id, code));
parts.push(`__req(${JSON.stringify(ENTRY)});`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${parts.join('\n\n')}\n`, 'utf8');

console.log(`打包完成: ${path.relative(ROOT, outFile)}`);
console.log(`  模块 ${modules.size} 个: ${[...modules.keys()].join(', ')}`);
console.log(`  体积 ${Math.round(fs.statSync(outFile).size / 1024)} KB`);
