/**
 * 一次生成全部产物：HTML / Word / Excel。
 *
 * 共用一份代码素材——代码只读一次、截图只渲染一次，
 * 三个产物用的是同一批图，不会出现「文档里有图、HTML 里是文字」的不一致。
 */
const fs = require('node:fs');
const path = require('node:path');

const { buildReport, readCode, BASE } = require('./build');
const { buildDocx } = require('./docx');
const { buildXlsx, rowsFromFragment } = require('./xlsx');
const { addedFiles } = require('./changes');
const { decodeEntities } = require('./html-blocks');
const { langFromFile } = require('./highlight');
const { renderCodeImages } = require('./render');

const attr = (tag, name) => (String(tag).match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) || [])[1] || '';

/** 把代码占位换成带编号的占位，同时取出代码原文。 */
function resolveCodeBlocks(html, repoRoot, log) {
  const assets = [];
  const out = html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (whole, attrs, inner) => {
    if (!/data-code-(file|lang)/i.test(attrs)) return whole;
    const file = attr(attrs, 'data-code-file');
    const range = attr(attrs, 'data-code-range');
    let code = '';
    try {
      code = file ? readCode(repoRoot, file, range) : decodeEntities(inner);
    } catch (err) {
      log(`  ! 代码读取失败：${err.message}`);
      return '';
    }
    code = code.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
    if (!code) return '';
    const idx = assets.length;
    const lang = attr(attrs, 'data-code-lang') || attr(attrs, 'lang') || langFromFile(file);
    assets.push({
      text: code,
      lang,
      file: file || '',
      range: range || '',
      // 图里的标注：文件:行号，审阅的人能对着代码找到位置
      caption: file ? `${file}${range ? `  第 ${range} 行` : ''}` : '',
      lines: code.split('\n').length
    });
    log(`  #${String(idx + 1).padStart(2, '0')} ${file ? `${file}:${range || 'all'}` : 'inline'}`
      + ` (${assets[idx].lines} 行${lang ? ` · ${lang}` : ''})`);
    return `<pre data-code-idx="${idx}"></pre>`;
  });
  return { html: out, assets };
}

/** 代码图在 HTML 里的呈现：居中、等比、带边框。 */
const imageHtml = (asset) => {
  const src = `data:image/png;base64,${asset.png.toString('base64')}`;
  return `<p style="${BASE}margin:12px 0;text-align:center;">`
    + `<img src="${src}" alt="${asset.caption || '代码片段'}"`
    + ' style="max-width:100%;height:auto;border:1px solid #e5e8eb;border-radius:3px;" /></p>';
};

/**
 * @param {object} options
 * @param {string} options.input      片段 HTML 路径
 * @param {string} [options.outdir]   输出目录，默认 ./change-report
 * @param {string} [options.repoRoot]
 * @param {boolean} [options.docx]    产出 Word
 * @param {boolean} [options.xlsx]    产出 Excel（隐含 docx）
 * @param {boolean} [options.codeImage] 代码块转图片，默认 true
 * @param {(s:string)=>void} [options.log]
 */
function buildAll(options) {
  if (!options.input) throw new Error('缺少 input');
  const log = options.log || (() => {});
  const input = path.resolve(options.input);
  if (!fs.existsSync(input)) throw new Error(`输入文件不存在: ${input}`);
  const outdir = path.resolve(options.outdir || './change-report');
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const basename = options.basename || path.basename(input).replace(/\.(fragment\.)?html?$/i, '') || 'report';
  const wantXlsx = options.xlsx === true;
  const wantDocx = options.docx === true || wantXlsx;
  const useImage = options.codeImage !== false;

  const raw = fs.readFileSync(input, 'utf8');
  const { html: fragment, assets } = resolveCodeBlocks(raw, repoRoot, log);
  log(`  共 ${assets.length} 段代码`);

  let imageCount = 0;
  if (useImage) {
    imageCount = renderCodeImages(assets, { log });
    if (imageCount) log(`  代码截图 ${imageCount}/${assets.length} 张`);
  } else {
    log('  按要求使用文本代码块（不生成截图）');
  }

  fs.mkdirSync(outdir, { recursive: true });
  const result = { files: [], assets: assets.length, images: imageCount };

  // HTML：有图的用图，没图的自动退回 <pre>
  const built = buildReport({
    input,
    outdir,
    repoRoot,
    log: () => {},
    renderAsset: ({ index }) => {
      const asset = assets[index];
      return asset && asset.png ? imageHtml(asset) : null;
    }
  });
  result.html = built;
  result.files.push({ type: 'html', file: built.outFile, bytes: built.bytes });

  if (wantDocx) {
    const docxFile = path.join(outdir, `${basename}.docx`);
    const buf = buildDocx({ html: fragment, assets, title: basename, author: options.author });
    fs.writeFileSync(docxFile, buf);
    result.docx = docxFile;
    result.files.push({ type: 'docx', file: docxFile, bytes: buf.length });
  }

  if (wantXlsx) {
    // 新增文件靠 git 判，拿不到就当没有；类别、小类剩下的部分按标题/扩展名自动匹配
    let newFiles = null;
    try {
      newFiles = addedFiles(repoRoot);
      if (newFiles && newFiles.size) log(`  新增文件 ${newFiles.size} 个（类别自动判为「新增程序」）`);
    } catch {
      newFiles = null;
    }
    const rows = rowsFromFragment(fragment, { newFiles });
    const xlsxFile = path.join(outdir, `${basename}.xlsx`);
    const { buffer, rowCount } = buildXlsx({ rows, title: basename, author: options.author });
    fs.writeFileSync(xlsxFile, buffer);
    result.xlsx = xlsxFile;
    result.files.push({ type: 'xlsx', file: xlsxFile, bytes: buffer.length, rows: rowCount });
  }

  return result;
}

module.exports = { buildAll, resolveCodeBlocks };
