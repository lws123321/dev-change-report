/**
 * 把片段 HTML 解析成简单的节点树，供 docx / xlsx 导出共用。
 *
 * 只处理我们白名单内的标签，容错优先：标签不闭合、属性乱写都不抛异常。
 * 不引第三方解析器是刻意的——这个包运行时不带任何依赖。
 */

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
// 这些容器里的纯空白文本节点直接丢掉，否则会凭空多出空段落
const SKIP_WS = new Set(['#root', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'div']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', mdash: '—', hellip: '…', times: '×' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const hit = ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m = re.exec(raw);
  while (m) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? 'true');
    m = re.exec(raw);
  }
  return attrs;
}

/**
 * @param {string} html
 * @returns {{name:string, attrs:object, children:Array}}
 */
function parse(html) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let cursor = 0;
  let m = re.exec(html);

  const top = () => stack[stack.length - 1];
  const pushText = (raw) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    if (!text.trim() && SKIP_WS.has(top().name)) return;
    top().children.push({ name: '#text', text, children: [] });
  };

  while (m) {
    pushText(html.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const [, closing, rawName, attrStr, selfClose] = m;
    const name = rawName.toLowerCase();

    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    } else {
      const node = { name, attrs: parseAttrs(attrStr || ''), children: [] };
      top().children.push(node);
      if (!selfClose && !VOID.has(name)) stack.push(node);
    }
    m = re.exec(html);
  }
  pushText(html.slice(cursor));
  return root;
}

/** 节点的纯文本（不含子标签换行）。 */
const textOf = (node) => node.children
  .map((c) => (c.name === '#text' ? c.text : textOf(c)))
  .join('');

/** 收集指定名字的后代节点（不含自身）。 */
function findAll(node, name, out = []) {
  for (const child of node.children) {
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

/** 折叠空白、去掉多余行，用于标题/单元格等单行文本。 */
const tidy = (text) => String(text).replace(/\s+/g, ' ').trim();

module.exports = { parse, parseAttrs, decodeEntities, textOf, findAll, tidy };
