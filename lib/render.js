/**
 * 代码块 -> PNG（供 Word / HTML 嵌入）。
 *
 * 只做调度：写临时文件、拼 manifest、起一次 PowerShell、把 PNG 读回来。
 * 渲染不出来不算失败——调用方会退回文本代码块，文档照常出。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { highlight, COLORS } = require('./highlight');

/**
 * 渲染分辨率是显示尺寸的 1.5 倍。
 * 2 倍时字更锐利，但 base64 嵌进 HTML 后能到 900 KB，粘进编辑器会卡；
 * 1.5 倍在 478pt 的显示宽度下约 144 DPI，打印和屏阅看都够。
 */
const SCALE = 1.5;
/** 显示宽度（约等于 A4 正文宽度 640px）。 */
const DISPLAY_WIDTH = 640;
const FONT_SIZE = 12;

const PS_CANDIDATES = ['pwsh', 'powershell'];

/**
 * 代码 -> 按行拆开的彩色片段，交给 PowerShell 逐段绘制。
 * 着色在 JS 侧做：PowerShell 画像素已经够忙了，不再让它认语法。
 * @returns {Array<Array<{t:string, c:string}>>}
 */
function buildSegments(text, lang) {
  const tokens = highlight(text, lang);
  const lines = [[]];
  for (const token of tokens) {
    const color = COLORS[token.type] || COLORS.plain;
    token.text.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: part, c: color });
    });
  }
  return lines;
}

function findPowerShell() {
  for (const exe of PS_CANDIDATES) {
    const probe = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000
    });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

/**
 * 给每个 asset 补上 png（Buffer）与 scale 字段。返回成功渲染的条数。
 * @param {Array<{text:string, caption?:string}>} assets
 * @param {{log?:Function, maxWidth?:number}} [options]
 */
function renderCodeImages(assets, options = {}) {
  const log = options.log || (() => {});
  if (!assets.length) return 0;
  if (process.platform !== 'win32') {
    log('  · 非 Windows 环境，跳过代码截图（自动改用文本代码块）');
    return 0;
  }
  const script = path.join(__dirname, 'render-code.ps1');
  if (!fs.existsSync(script)) {
    log('  · 找不到 render-code.ps1，改用文本代码块');
    return 0;
  }
  const exe = findPowerShell();
  if (!exe) {
    log('  · 没有可用的 PowerShell，改用文本代码块');
    return 0;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcr-img-'));
  try {
    const maxWidth = (options.maxWidth || DISPLAY_WIDTH) * SCALE;
    const jobs = assets.map((asset, i) => {
      asset.scale = SCALE;
      const src = path.join(tmp, `code-${i}.txt`);
      fs.writeFileSync(src, asset.text, 'utf8');
      return {
        input: src,
        output: path.join(tmp, `code-${i}.png`),
        caption: asset.caption || '',
        segments: buildSegments(asset.text, asset.lang),
        maxWidth
      };
    });
    const manifest = path.join(tmp, 'jobs.json');
    fs.writeFileSync(manifest, JSON.stringify(jobs), 'utf8');

    const run = spawnSync(
      exe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Manifest', manifest, '-FontSize', String(FONT_SIZE * SCALE)],
      { encoding: 'utf8', windowsHide: true, timeout: 180000 }
    );
    if (run.error || run.status !== 0) {
      const reason = run.error ? run.error.message : `exit ${run.status}`;
      log(`  · 代码截图失败（${reason}），改用文本代码块`);
      return 0;
    }

    let ok = 0;
    for (let i = 0; i < assets.length; i += 1) {
      const png = jobs[i].output;
      if (fs.existsSync(png)) {
        assets[i].png = fs.readFileSync(png);
        ok += 1;
      }
    }
    return ok;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { renderCodeImages, findPowerShell, buildSegments, SCALE, DISPLAY_WIDTH };
