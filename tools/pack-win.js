#!/usr/bin/env node
/**
 * 把 exe + install.cmd + 使用说明打成 Windows 分发包 dist/dcr-win-x64.zip。
 *
 * 只在确实需要「无 Node 环境」分发时使用，日常交付走 npm 包（10 KB）。
 * 用法：npm run pack:win
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const EXE = path.join(DIST, 'dcr.exe');
const ZIP = path.join(DIST, 'dcr-win-x64.zip');
const pkg = require('../package.json');

if (!fs.existsSync(EXE)) {
  console.error('缺少 dist/dcr.exe，先执行 npm run exe');
  process.exit(1);
}

const README = `dcr —— 代码改动说明文档生成器 v${pkg.version}
================================

安装（二选一）

  方式 A：双击 install.cmd
          自动复制到 %LOCALAPPDATA%\\Programs\\dcr，加入 PATH，并注册 skill。

  方式 B：手动
          1. 把 dcr.exe 放到任意目录，例如 C:\\Tools\\dcr
          2. 执行 dcr.exe install

装完重启编辑器，对 AI 说「整理一下这次改动」即可触发。

用法

  dcr install [--project] [--force]          安装 skill
  dcr build --input frag.html --repo-root .  生成 report.html
  dcr changes --repo . --base origin/release 收集 git 改动
  dcr --version                              查看版本
  dcr help                                   查看帮助

说明

  - 绿色单文件，不用装 Node，不用联网。
  - 体积 83 MB 来自内嵌的 Node 运行时，无法裁剪。
    如果对方已安装 Node，改用 npm 包（10 KB）更划算。
  - 首次运行可能触发 SmartScreen 提示：点「更多信息」→「仍要运行」。
    要彻底消除需用企业证书对 exe 签名。
`;

// 用临时目录组织内容，避免把说明文件写到 dist 根污染产物目录。
// 文件名保持 ASCII：中文名经 bsdtar → Expand-Archive 往返会乱码。
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dcr-pack-'));
fs.copyFileSync(EXE, path.join(stage, 'dcr.exe'));
fs.copyFileSync(path.join(ROOT, 'packaging', 'install.cmd'), path.join(stage, 'install.cmd'));
fs.writeFileSync(path.join(stage, 'README.txt'), `\uFEFF${README}`, 'utf8');

fs.rmSync(ZIP, { force: true });
// Windows 自带的 bsdtar 支持 -a 按扩展名自动选格式，避免依赖 PowerShell 的 Archive 模块。
execFileSync('tar', ['-a', '-c', '-f', ZIP, '-C', stage, '.'], { stdio: 'inherit' });

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n完成: ${path.relative(ROOT, ZIP)} (${mb(fs.statSync(ZIP).size)})`);
console.log(`  dcr.exe       ${mb(fs.statSync(EXE).size)}`);
fs.rmSync(stage, { recursive: true, force: true });
