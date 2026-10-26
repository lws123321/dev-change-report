/**
 * 报告生成核心：把带 <pre data-code-*> 占位的 HTML 片段转成富文本 HTML。
 * 片段里不写任何 style，样式由 STYLE / TIP 两个字典统一注入。
 */
const fs = require('node:fs');
const path = require('node:path');

// ---- 样式字典：只改这里，全文观感随之变化 ----
const BASE = 'font-size:14px;line-height:1.75;color:#2f363d;';
const STYLE = {
  h2: 'font-size:19px;font-weight:600;margin:26px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e8eb;color:#1f2328;',
  h3: 'font-size:15px;font-weight:600;margin:18px 0 8px;color:#1f2328;',
  p: `${BASE}margin:10px 0;`,
  ul: `${BASE}margin:10px 0 10px 22px;padding:0;`,
  li: 'margin:4px 0;',
  table: 'border-collapse:collapse;width:100%;font-size:13px;margin:12px 0;',
  th: 'padding:7px 10px;text-align:left;border:1px solid #dfe3e6;background:#f6f8fa;font-weight:600;',
  td: 'padding:7px 10px;border:1px solid #dfe3e6;vertical-align:top;',
  code: 'background:#f2f4f6;padding:1px 5px;border-radius:3px;font-family:Consolas,Monaco,monospace;font-size:13px;color:#b3320f;',
  pre: 'background:#f6f8fa;border:1px solid #e5e8eb;border-radius:3px;padding:10px 12px;margin:10px 0;'
    // 字体名用单引号：这段会塞进 style="..." 里，写双引号会把属性提前闭合，
    // 结果 white-space:pre-wrap 跑到属性外面，代码块就被挤成一行了。
    + "font-family:Consolas,Monaco,'Courier New',monospace;font-size:13px;line-height:1.55;"
    + 'white-space:pre-wrap;word-break:break-word;color:#24292f;'
};
const TIP = {
  info: ['#f2f7f4', '#0a7a50'],
  warn: ['#fdf8e9', '#c99515'],
  danger: ['#fcf0ef', '#c0392b']
};

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeEntities = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const attr = (tag, name) => (tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) || [])[1] || '';

/** 从文件按 1-based 闭区间截取；range 形如 "40-60"，省略则取全文。 */
function readCode(repoRoot, file, range) {
  const full = path.isAbsolute(file) ? file : path.join(repoRoot, file);
  if (!fs.existsSync(full)) throw new Error(`data-code-file 指向的文件不存在: ${full}`);
  const lines = fs.readFileSync(full, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  if (!range) return lines.join('\n');
  const [a, b] = String(range).split('-');
  const from = Math.max(1, parseInt(a, 10) || 1);
  const to = b ? Math.min(lines.length, parseInt(b, 10) || lines.length) : lines.length;
  return lines.slice(from - 1, to).join('\n');
}

/**
 * 占位 -> 代码块。必须在注入样式之前执行，避免代码里的 <h2> 被误处理。
 *
 * @param {(meta:{index:number,file:string,range:string,code:string})=>string|null} [renderAsset]
 *        返回自定义 HTML 时用它（例如嵌代码截图），返回 null 则用默认的 <pre>
 */
function renderCodeBlocks(html, repoRoot, log, renderAsset) {
  let seq = 0;
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (whole, attrs, inner) => {
    if (!/data-code-(file|lang)/i.test(attrs)) return whole;
    const index = seq;
    seq += 1;
    const file = attr(attrs, 'data-code-file');
    const range = attr(attrs, 'data-code-range');
    const raw = file ? readCode(repoRoot, file, range) : decodeEntities(inner);
    const code = raw.replace(/^\n+/, '').replace(/\s+$/, '');
    if (!code) { log(`  ! #${seq} 空代码块，已跳过`); return ''; }
    const src = file ? `${file}:${range || 'all'}` : 'inline';
    log(`  #${String(seq).padStart(2, '0')} ${src} (${code.split('\n').length} 行)`);
    if (renderAsset) {
      const custom = renderAsset({ index, file, range, code });
      if (custom != null) return custom;
    }
    return `<pre style="${STYLE.pre}">${escapeHtml(code)}</pre>`;
  });
}

/** 给没有 style 的标签补默认样式。 */
const styleTag = (html, tag, style) =>
  html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'), (m, attrs = '') =>
    /\bstyle\s*=/i.test(attrs) ? m : `<${tag}${attrs} style="${style}">`);

const applyTips = (html) =>
  html.replace(/<p\s+tip="(\w+)"[^>]*>([\s\S]*?)<\/p>/gi, (m, kind, inner) => {
    const [bg, border] = TIP[kind] || TIP.info;
    return `<p style="${BASE}margin:10px 0;padding:8px 12px;background:${bg};border-left:3px solid ${border};">${inner}</p>`;
  });

const TAGS = ['h2', 'h3', 'p', 'ul', 'li', 'table', 'th', 'td', 'code'];

/** 这些属性只给 Word / Excel 导出用，留在 HTML 里对编辑器无意义。 */
const stripMetaAttrs = (html) => html.replace(/\s+data-(?:category|module|files)="[^"]*"/gi, '');

/**
 * @param {object} options
 * @param {string} options.input   片段 HTML 路径
 * @param {string} [options.outdir] 输出目录，默认 ./change-report
 * @param {string} [options.repoRoot] data-code-file 的解析根目录
 * @param {string} [options.outFile] 输出文件名，默认 report.html
 * @param {boolean} [options.quiet] 不要默认输出
 * @param {(s:string)=>void} [options.log]
 * @param {Function} [options.renderAsset] 自定义代码块渲染（见 renderCodeBlocks）
 * @returns {{outFile:string, bytes:number}}
 */
function buildReport(options) {
  if (!options.input) throw new Error('缺少 input');
  const input = path.resolve(options.input);
  if (!fs.existsSync(input)) throw new Error(`输入文件不存在: ${input}`);
  const outdir = path.resolve(options.outdir || './change-report');
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const log = options.log || (() => {});

  let html = fs.readFileSync(input, 'utf8');
  html = renderCodeBlocks(html, repoRoot, log, options.renderAsset);
  html = stripMetaAttrs(html);
  html = applyTips(html);
  for (const tag of TAGS) html = styleTag(html, tag, STYLE[tag]);

  fs.mkdirSync(outdir, { recursive: true });
  const outFile = path.join(outdir, options.outFile || 'report.html');
  const out = html.trim() + '\n';
  fs.writeFileSync(outFile, out, 'utf8');
  return { outFile, bytes: Buffer.byteLength(out) };
}

module.exports = { buildReport, readCode, STYLE, TIP, BASE };
