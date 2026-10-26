/**
 * 明细表 -> Excel .xlsx（SpreadsheetML）。
 *
 * 版式对齐「导入模板_明细表1.xls」：
 *   第 1 行 提醒（合并 A:F）
 *   第 2 行 表头：类别(*) 明细内容(*) 小类(*) 模组 语言 备注
 *   第 3 行起 数据
 * 注意：模板本体是老的 BIFF8 .xls，这里产出 .xlsx；
 * 若导入工具只认 .xls，在 Excel 里「另存为 Excel 97-2003 工作簿」即可。
 */
const { createZip, xmlEscape } = require('./zip');
const { parse, textOf, tidy } = require('./html-blocks');

const SHEET_NAME = '输入模板_明细表1';
const NOTICE = '提醒：目前的excel导入功能仅支持简单的明细表，建议逻辑复杂的明细表手动输入！';
const HEADERS = ['类别(*)', '明细内容(*)', '小类(*)', '模组', '语言', '备注'];
// 明细内容列放文件路径，要比其他列宽；备注只写一句短说明，窄一点就够
const COL_WIDTHS = [14, 66, 18, 18, 7, 46];

const ENUM_CATEGORY = ['程序修正', '需求变更', '程序优化', '新增程序', '数据修正'];
const ENUM_KIND = [
  'OTHERS（另外）', 'JAVA（后端）', 'WEB（前端）', 'FORM（表单）', 'FUNCTION（函数）', 'INDEX（索引）',
  'PACKAGE（包）', 'PLL（Form包）', 'PROCEDURE（过程）', 'REPORT（RDF报表）', 'RTF（RTF模板）',
  'SYNONYM（同义词）', 'TABLE（表格）', 'TRIGGER（触发器）', 'VIEW（视图）', 'DLL（动态链接库）',
];

/**
 * 扩展名 → 小类。取值必须和导入模板隐藏页的字典逐字一致，
 * 否则导入端认不出下拉值（全角括号别改成半角）。
 */
const KIND_BY_EXT = {
  // 前端
  vue: 'WEB（前端）', js: 'WEB（前端）', mjs: 'WEB（前端）', cjs: 'WEB（前端）',
  jsx: 'WEB（前端）', ts: 'WEB（前端）', tsx: 'WEB（前端）',
  html: 'WEB（前端）', htm: 'WEB（前端）', wxml: 'WEB（前端）',
  css: 'WEB（前端）', scss: 'WEB（前端）', sass: 'WEB（前端）', less: 'WEB（前端）', styl: 'WEB（前端）',
  // 后端
  java: 'JAVA（后端）', kt: 'JAVA（后端）', cs: 'JAVA（后端）',
  // 数据库对象
  sql: 'PROCEDURE（过程）', prc: 'PROCEDURE（过程）', fnc: 'FUNCTION（函数）',
  pck: 'PACKAGE（包）', pkb: 'PACKAGE（包）', trg: 'TRIGGER（触发器）',
  vw: 'VIEW（视图）', tab: 'TABLE（表格）', idx: 'INDEX（索引）', syn: 'SYNONYM（同义词）',
  rdf: 'REPORT（RDF报表）', rtf: 'RTF（RTF模板）',
  // EBS / Forms
  fmb: 'FORM（表单）', fmx: 'FORM（表单）', pll: 'PLL（Form包）', plx: 'PLL（Form包）',
  dll: 'DLL（动态链接库）',
};
const DATA_EXT = /^(sql|prc|pck|pkb|fnc|trg|vw|tab|idx|syn)$/i;

/** 从文件路径推断小类（导入模板的下拉字典）。认不出的归 OTHERS（另外）。 */
function kindFromFile(file) {
  const ext = (String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return (ext && KIND_BY_EXT[ext]) || 'OTHERS（另外）';
}

const colLetter = (index) => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const cell = (ref, value, style) => (value === '' || value === undefined || value === null
  ? `<c r="${ref}" s="${style}"/>`
  : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`);

function sheetXml(rows) {
  const lastCol = colLetter(HEADERS.length - 1);
  const lastRow = rows.length + 2;
  const cols = COL_WIDTHS
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const noticeRow = `<row r="1" ht="20" customHeight="1">${cell('A1', NOTICE, 3)}</row>`;
  const headRow = `<row r="2" ht="30" customHeight="1">${HEADERS
    .map((h, i) => cell(`${colLetter(i)}2`, h, 1))
    .join('')}</row>`;
  const bodyRows = rows
    .map((row, i) => {
      const r = i + 3;
      const cells = row.map((v, c) => cell(`${colLetter(c)}${r}`, v, 2)).join('');
      // 不写 ht/customHeight：路径长短不一，交给 Excel 按内容算行高
      return `<row r="${r}">${cells}</row>`;
    })
    .join('');

  const validations = [
    ['A', ENUM_CATEGORY],
    ['C', ENUM_KIND],
  ]
    .map(([col, list]) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
      + ` sqref="${col}3:${col}500"><formula1>"${xmlEscape(list.join(','))}"</formula1></dataValidation>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0">
<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>
<selection pane="bottomLeft" activeCell="A3" sqref="A3"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16.5"/>
<cols>${cols}</cols>
<sheetData>${noticeRow}${headRow}${bodyRows}</sheetData>
<mergeCells count="1"><mergeCell ref="A1:${lastCol}1"/></mergeCells>
<dataValidations count="2">${validations}</dataValidations>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><color theme="1"/><name val="宋体"/><charset val="134"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="宋体"/><charset val="134"/></font>
<font><sz val="10"/><color rgb="FF7A8289"/><name val="宋体"/><charset val="134"/></font>
<font><sz val="10"/><i/><color rgb="FFB3320F"/><name val="宋体"/><charset val="134"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFBFBFBF"/></left>
<right style="thin"><color rgb="FFBFBFBF"/></right>
<top style="thin"><color rgb="FFBFBFBF"/></top>
<bottom style="thin"><color rgb="FFBFBFBF"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const coreXml = (title, author, when) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(author)}</dc:creator>
<cp:lastModifiedBy>${xmlEscape(author)}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>
</cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>dev-change-report</Application></Properties>`;

/** 去掉「一、」「1.1」「（1）」这类标题序号；只认带分隔符的，避免误伤「2024 年总结」。 */
const stripNumbering = (s) => String(s)
  .replace(/^[\s\u3000]*[0-9０-９]+(?:[.．][0-9０-９]+)+[.．、)）]?[\s\u3000]*/u, '')
  .replace(/^[\s\u3000]*[0-9０-９]+[.．、)）][\s\u3000]*/u, '')
  .replace(/^[\s\u3000]*[一二三四五六七八九十]+[、.．][\s\u3000]*/u, '')
  .replace(/^[\s\u3000]*[（(][0-9０-９一二三四五六七八九十]+[)）][\s\u3000]*/u, '')
  .replace(/^[\s\u3000]*[①-⑳][\s\u3000]*/u, '')
  .trim();

/**
 * 从片段 HTML 归纳明细行。
 *
 * 一行 = 一个代码文件（导入模板的「明细内容」列本来就是填路径的，
 * 多个文件挤在一行会让导入端当成一条记录）。
 * 主线索是 h3，没写 h3 时退化成按 h2 分组。
 *
 * 类别、小类都会自动匹配：
 *   小类 ← 文件扩展名（`kindFromFile`），对照导入模板的下拉字典；
 *   类别 ← h2/h3 上的 `data-category` > 新增文件（git） > 数据脚本 > 标题关键词。
 * 手写的 `data-category` 始终优先，自动匹配只在没写时兜底。
 *
 * 没有引用任何文件的章节（验证记录、上线说明之类）不进表——
 * 明细内容列填不出路径，硬塞只会变成脏数据。
 *
 * @param {string} html
 * @param {object} [options]
 * @param {Set<string>} [options.newFiles] 分支内新增的文件，命中即判「新增程序」
 * @returns {string[][]}
 */
function rowsFromFragment(html, options = {}) {
  const root = parse(html);
  const groups = [];
  let sectionCategory = '';
  let current = null;
  let hasH3 = false;

  const filesUnder = (node, acc = []) => {
    const self = node.attrs && node.attrs['data-code-file'];
    if (self && !acc.includes(self)) acc.push(self);
    const declared = node.attrs && node.attrs['data-files'];
    if (declared) {
      for (const file of String(declared).split(/[,\uff0c]/)) {
        const name = file.trim();
        if (name && !acc.includes(name)) acc.push(name);
      }
    }
    for (const child of node.children) filesUnder(child, acc);
    return acc;
  };

  const heading = (node) => ({
    title: stripNumbering(tidy(textOf(node))),
    category: tidy(node.attrs?.['data-category'] || '')
  });

  for (const node of root.children) {
    if (node.name === 'h2' || node.name === 'h1') {
      const head = heading(node);
      sectionCategory = head.category;
      current = null;
      continue;
    }
    if (node.name === 'h3' || node.name === 'h4') {
      hasH3 = true;
      current = {
        title: stripNumbering(tidy(textOf(node))),
        category: sectionCategory,
        files: filesUnder(node)
      };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    for (const file of filesUnder(node)) {
      if (!current.files.includes(file)) current.files.push(file);
    }
  }

  if (!hasH3) {
    // 没有 h3：按 h2 分节，标题取 h2
    groups.length = 0;
    let bucket = null;
    for (const node of root.children) {
      if (node.name === 'h2' || node.name === 'h1') {
        bucket = { ...heading(node), files: filesUnder(node) };
        groups.push(bucket);
        continue;
      }
      if (!bucket) continue;
      for (const file of filesUnder(node)) {
        if (!bucket.files.includes(file)) bucket.files.push(file);
      }
    }
  }

  // 「备注」只留一句短说明，长标题截断（导入端那一列放不下整段话）
  const NOTE_MAX = 40;
  const note = (s) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1)}…` : s);
  const newFiles = options.newFiles || null;
  const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const guessCategory = (title, file) => {
    const path = normPath(file);
    if (newFiles && (newFiles.has(path) || newFiles.has(`./${path}`))) return '新增程序';
    if (DATA_EXT.test((path.match(/\.([a-z0-9]+)$/i) || [])[1] || '')) return '数据修正';
    if (/优化|性能|重构|瘦身|提速|首屏/.test(title)) return '程序优化';
    if (/需求|新增|新功能|适配|支持/.test(title)) return '需求变更';
    return '程序修正';
  };

  const rows = [];
  const seen = new Set();
  for (const group of groups) {
    if (!group.files.length) continue;
    const fixed = ENUM_CATEGORY.includes(group.category) ? group.category : '';
    const remark = note(group.title || '');
    for (const file of group.files) {
      // 同一文件可能在多个改动点出现，清单只留一条，备注取首次出现的说明
      if (seen.has(file)) continue;
      seen.add(file);
      const category = fixed || guessCategory(group.title, file);
      // 小类按文件类型自动匹配；模组、语言留空：由导入方按实际情况填
      rows.push([category, file, kindFromFile(file), '', '', remark]);
    }
  }
  return rows;
}

/**
 * @param {object} options
 * @param {string[][]} options.rows
 * @param {string} [options.title]
 * @param {string} [options.author]
 * @returns {{buffer: Buffer, rowCount: number}}
 */
function buildXlsx(options) {
  const rows = options.rows || [];
  const title = options.title || '改动明细';
  const author = options.author || 'dev-change-report';
  const when = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const buffer = createZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', data: WB_RELS },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows) },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'docProps/core.xml', data: coreXml(title, author, when) },
    { name: 'docProps/app.xml', data: APP_XML },
  ]);
  return { buffer, rowCount: rows.length };
}

module.exports = { buildXlsx, rowsFromFragment, kindFromFile, SHEET_NAME, HEADERS, ENUM_KIND, ENUM_CATEGORY };
