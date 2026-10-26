/**
 * 片段 HTML -> Word .docx（OOXML）。
 *
 * 代码块两种形态：
 *   · 有 PNG（assets[i].png）-> 嵌图片，带文件名与行号标注；
 *   · 没 PNG（非 Windows、渲染失败、主动关闭）-> 退回浅灰底 + 语法着色的文本。
 * 两条路径都不报错，文档总能出来。
 */
const { createZip, xmlEscape, pngSize } = require('./zip');
const { parse, textOf } = require('./html-blocks');
const { highlight, COLORS } = require('./highlight');

const EMU_PER_PX = 9525;
const PAGE_W = 11906; // A4 宽（twip）
const MARGIN = 1134; // 2cm
const CONTENT_TWIP = PAGE_W - MARGIN * 2;
const CONTENT_EMU = CONTENT_TWIP * 635; // 1 twip = 635 EMU

const TIP = {
  info: ['F2F7F4', '0A7A50'],
  warn: ['FDF8E9', 'C99515'],
  danger: ['FCF0EF', 'C0392B']
};

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
].join(' ');

// ---------- 行内 ----------

/** 文本 -> w:t 序列。换行转 <w:br/>，制表符转 <w:tab/>，否则 Word 会吞掉缩进。 */
function textXml(text) {
  const lines = String(text).split('\n');
  return lines
    .map((line, i) => {
      const head = i ? '<w:br/>' : '';
      if (!line) return head;
      const body = line
        .split('\t')
        .map((seg, j) => {
          const tab = j ? '<w:tab/>' : '';
          return seg ? `${tab}<w:t xml:space="preserve">${xmlEscape(seg)}</w:t>` : tab;
        })
        .join('');
      return head + body;
    })
    .join('');
}

function runXml(text, fmt = {}) {
  if (!text) return '';
  const props = [];
  if (fmt.code) props.push('<w:rStyle w:val="CodeChar"/>');
  if (fmt.bold) props.push('<w:b/>');
  if (fmt.italic) props.push('<w:i/>');
  if (fmt.underline) props.push('<w:u w:val="single"/>');
  if (fmt.color) props.push(`<w:color w:val="${fmt.color}"/>`);
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}${textXml(text)}</w:r>`;
}

/** 行内节点 -> run 序列。未知标签按透明容器处理。 */
function inlineXml(node, fmt = {}) {
  let out = '';
  for (const child of node.children) {
    switch (child.name) {
      case '#text':
        out += runXml(child.text, fmt);
        break;
      case 'br':
        out += '<w:r><w:br/></w:r>';
        break;
      case 'b':
      case 'strong':
        out += inlineXml(child, { ...fmt, bold: true });
        break;
      case 'i':
      case 'em':
        out += inlineXml(child, { ...fmt, italic: true });
        break;
      case 'code':
        out += inlineXml(child, { ...fmt, code: true });
        break;
      case 'a':
        out += inlineXml(child, { ...fmt, underline: true, color: '0969DA' });
        break;
      default:
        out += inlineXml(child, fmt);
    }
  }
  return out;
}

const para = (styleId, inner, extraPPr = '') =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${extraPPr}</w:pPr>${inner}</w:p>`;

// ---------- 块 ----------

/**
 * 按内容长度分配列宽。
 * 直接均分会让「需求编号」这种短标签占掉半页，长内容反而被挤窄；
 * 取平方根是为了压缩极端差值——短列不至于窄到折行，长列也不至于吃掉全部宽度。
 */
const COL_MIN = 720;
function columnWidths(rows, cols, total) {
  const maxLen = new Array(cols).fill(0);
  for (const row of rows) {
    const cells = row.children.filter((c) => c.name === 'th' || c.name === 'td');
    cells.forEach((cell, i) => {
      if (i < cols) maxLen[i] = Math.max(maxLen[i], textOf(cell).trim().length);
    });
  }
  const weights = maxLen.map((n) => Math.sqrt(Math.max(n, 4)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const clamped = weights.map((w) => Math.max(COL_MIN, (w / sum) * total));
  const used = clamped.reduce((a, b) => a + b, 0);
  const widths = clamped.map((w) => Math.floor((w * total) / used));
  // 取整会丢几 twip，补给最宽的那列，保证表格正好铺满正文宽度
  const rest = total - widths.reduce((a, b) => a + b, 0);
  if (rest) widths[widths.indexOf(Math.max(...widths))] += rest;
  return widths;
}

function tableXml(node) {
  const rows = node.children.filter((c) => c.name === 'tr');
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.children.filter((c) => c.name === 'th' || c.name === 'td').length));
  if (!cols) return '';
  const widths = columnWidths(rows, cols, CONTENT_TWIP);
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="DFE3E6"/>`;

  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const body = rows
    .map((row) => {
      const cells = row.children.filter((c) => c.name === 'th' || c.name === 'td');
      const cellsXml = cells
        .map((cell, i) => {
          const head = cell.name === 'th';
          const shd = head ? '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>' : '';
          const inner = `<w:p><w:pPr><w:pStyle w:val="${head ? 'TableHead' : 'TableText'}"/></w:pPr>${inlineXml(cell, head ? { bold: true } : {})}</w:p>`;
          return `<w:tc><w:tcPr><w:tcW w:w="${widths[i] || widths[widths.length - 1]}" w:type="dxa"/>${shd}<w:vAlign w:val="top"/></w:tcPr>${inner}</w:tc>`;
        })
        .join('');
      return `<w:tr>${cellsXml}</w:tr>`;
    })
    .join('');

  return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
    + '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
    + '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>'
    + `</w:tblPr>${grid}${body}</w:tbl>`;
}

function listXml(node, ctx) {
  const ordered = node.name === 'ol';
  return node.children
    .filter((c) => c.name === 'li')
    .map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : '• ';
      const pad = 240 + ctx.depth * 360;
      const pPr = `<w:ind w:left="${pad}" w:hanging="240"/>`;
      const inner = runXml(marker) + inlineXml(li);
      // li 里如果再嵌列表，递归拼在后面
      const nested = li.children
        .filter((c) => c.name === 'ul' || c.name === 'ol')
        .map((c) => listXml(c, { ...ctx, depth: ctx.depth + 1 }))
        .join('');
      return para('Normal', inner, pPr) + nested;
    })
    .join('');
}

/**
 * 代码块：单段落承载整个代码块。
 * 用单段落而不是「一行一段」，是因为段落底纹只在段落范围内生效，
 * 拆成多段会出现段间白缝，看起来不像一个整体。
 */
const CODE_PPR = '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>'
  + '<w:pBdr>'
  + '<w:top w:val="single" w:sz="4" w:space="6" w:color="E5E8EB"/>'
  + '<w:left w:val="single" w:sz="18" w:space="8" w:color="D0D7DE"/>'
  + '<w:bottom w:val="single" w:sz="4" w:space="6" w:color="E5E8EB"/>'
  + '<w:right w:val="single" w:sz="4" w:space="6" w:color="E5E8EB"/>'
  + '</w:pBdr>'
  + '<w:spacing w:before="120" w:after="120" w:line="260" w:lineRule="auto"/>'
  + '<w:ind w:left="160" w:right="120"/>';

function codeBlockXml(text, lang) {
  const code = String(text || '').replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (!code) return '';
  const runs = highlight(code, lang)
    .map((token) => runXml(token.text, token.type === 'plain' ? {} : { color: COLORS[token.type] || COLORS.plain }))
    .join('');
  return para('CodeBlock', runs, CODE_PPR);
}

/** 代码图：等比缩到正文宽度，不放大。 */
function codeImageXml(asset, ctx) {
  const size = pngSize(asset.png);
  if (!size) return '';
  const k = EMU_PER_PX / (asset.scale || 1);
  let cx = size.width * k;
  let cy = size.height * k;
  if (cx > CONTENT_EMU) {
    const ratio = CONTENT_EMU / cx;
    cx = Math.round(cx * ratio);
    cy = Math.round(cy * ratio);
  }
  const id = ctx.images.length + 1;
  const rId = `rId${100 + id}`;
  const name = `code-${id}.png`;
  ctx.images.push({ name, rId, png: asset.png });

  const drawing = '<w:r><w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="代码片段 ${id}"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

  return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/><w:keepNext/><w:jc w:val="center"/></w:pPr>${drawing}</w:p>`;
}

function preXml(node, ctx) {
  if (node.attrs['data-code-idx'] !== undefined) {
    const asset = ctx.assets[Number(node.attrs['data-code-idx'])];
    if (asset) {
      // 有图就上图片（文档审阅要求图文并茂），没图退回着色文本
      if (asset.png) return codeImageXml(asset, ctx);
      return codeBlockXml(asset.text, asset.lang);
    }
  }
  const text = textOf(node);
  return text.trim() ? codeBlockXml(text, node.attrs['data-code-lang'] || node.attrs.lang) : '';
}

function blockXml(node, ctx) {
  switch (node.name) {
    case 'h1':
    case 'h2':
      return para('Heading1', inlineXml(node));
    case 'h3':
    case 'h4':
    case 'h5':
      return para('Heading2', inlineXml(node));
    case 'p': {
      const kind = node.attrs.tip;
      if (kind) {
        const [fill, border] = TIP[kind] || TIP.info;
        const pPr = `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`
          + `<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="${border}"/></w:pBdr>`
          + '<w:ind w:left="180" w:right="120"/>';
        return para('Normal', inlineXml(node), pPr);
      }
      return para('Normal', inlineXml(node));
    }
    case 'ul':
    case 'ol':
      return listXml(node, ctx);
    case 'li':
      return para('Normal', runXml('• ') + inlineXml(node));
    case 'table':
      return tableXml(node) + '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>';
    case 'pre':
      return preXml(node, ctx);
    case 'blockquote':
      return para('Normal', inlineXml(node), '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="DFE3E6"/></w:pBdr><w:ind w:left="240"/>');
    default:
      return node.children.some((c) => c.name === '#text')
        ? para('Normal', inlineXml(node))
        : node.children.map((c) => blockXml(c, ctx)).join('');
  }
}

// ---------- 部件 ----------

const stylesXml = (font) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="微软雅黑" w:cs="${font}"/>
<w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="80" w:after="80"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/>
<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="E5E8EB"/></w:pBdr><w:jc w:val="left"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="1F2328"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:jc w:val="left"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="1F2328"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="微软雅黑"/>
<w:sz w:val="19"/><w:color w:val="B3320F"/><w:shd w:val="clear" w:color="auto" w:fill="F2F4F6"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="120" w:after="120" w:line="260" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="微软雅黑"/>
<w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="24292F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="20" w:after="20" w:line="260" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>
<w:rPr><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableHead"><w:name w:val="Table Head"/><w:basedOn w:val="TableText"/>
<w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;

const documentXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}
<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="16838"/>
<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="851" w:footer="992" w:gutter="0"/>
<w:docGrid w:linePitch="312"/></w:sectPr></w:body></w:document>`;

const contentTypes = (imageCount) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageCount ? '<Default Extension="png" ContentType="image/png"/>' : ''}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const docRels = (images) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${images.map((img) => `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}"/>`).join('\n')}
</Relationships>`;

const coreXml = (title, author, when) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(author)}</dc:creator>
<cp:lastModifiedBy>${xmlEscape(author)}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>
</cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>dev-change-report</Application></Properties>`;

/**
 * @param {object} options
 * @param {string} options.html   已解析掉代码占位的片段 HTML（pre 上带 data-code-idx）
 * @param {Array<{text:string, lang:string}>} [options.assets] 按 idx 存放的代码素材
 * @param {string} [options.title]
 * @param {string} [options.author]
 * @param {string} [options.font]
 * @returns {Buffer}
 */
function buildDocx(options) {
  const ctx = { assets: options.assets || [], images: [], depth: 0 };
  const root = parse(options.html);
  const body = root.children.map((node) => blockXml(node, ctx)).join('\n');
  const title = options.title || '改动说明';
  const author = options.author || 'dev-change-report';
  const when = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes(ctx.images.length) },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: documentXml(body) },
    { name: 'word/styles.xml', data: stylesXml(options.font || 'Segoe UI') },
    { name: 'word/_rels/document.xml.rels', data: docRels(ctx.images) },
    ...ctx.images.map((img) => ({ name: `word/media/${img.name}`, data: img.png })),
    { name: 'docProps/core.xml', data: coreXml(title, author, when) },
    { name: 'docProps/app.xml', data: APP_XML }
  ]);
}

module.exports = { buildDocx };
