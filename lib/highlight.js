/**
 * 极简语法着色：把代码切成带类型的 token，供 Word 里上色。
 *
 * 不追求完整解析，只求「关键字、字符串、注释、数字」看不出错。
 * 认不出的语言一律按纯文本返回，不会报错、不会吞字符。
 */

/** GitHub Light 配色，和 HTML 报告里的浅色底一致。 */
const COLORS = {
  plain: '24292F',
  keyword: 'CF222E',
  string: '0A3069',
  comment: '6E7781',
  number: '0550AE',
  literal: '0550AE',
  function: '8250DF',
  type: '953800',
  tag: '116329',
  attr: '0550AE',
  add: '1A7F37',
  del: 'CF222E',
  hunk: '8250DF'
};

const KW_JS = 'abstract|as|async|await|break|case|catch|class|const|constructor|continue|declare|'
  + 'default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|'
  + 'import|in|infer|instanceof|interface|is|keyof|let|namespace|new|of|override|private|'
  + 'protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|'
  + 'typeof|var|void|while|yield';

const JS = [
  { type: 'comment', source: '/\\*[\\s\\S]*?\\*/' },
  { type: 'comment', source: '//[^\\n]*' },
  { type: 'string', source: '"(?:[^"\\\\\\n]|\\\\.)*"' },
  { type: 'string', source: "'(?:[^'\\\\\\n]|\\\\.)*'" },
  { type: 'string', source: '`(?:[^`\\\\]|\\\\[\\s\\S])*`' },
  { type: 'keyword', source: `\\b(?:${KW_JS})\\b` },
  { type: 'literal', source: '\\b(?:true|false|null|undefined|NaN|Infinity)\\b' },
  { type: 'number', source: '\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b' },
  { type: 'function', source: '[A-Za-z_$][\\w$]*(?=\\s*\\()' },
  { type: 'type', source: '\\b[A-Z][\\w$]*\\b' }
];

const MARKUP = [
  { type: 'comment', source: '<!--[\\s\\S]*?-->' },
  { type: 'tag', source: '</?[A-Za-z][\\w:-]*' },
  { type: 'attr', source: '[A-Za-z_:][\\w:.-]*(?=\\s*=)' },
  { type: 'string', source: '"[^"]*"' },
  { type: 'string', source: "'[^']*'" }
];

const CSS = [
  { type: 'comment', source: '/\\*[\\s\\S]*?\\*/' },
  { type: 'string', source: '"[^"]*"' },
  { type: 'string', source: "'[^']*'" },
  { type: 'keyword', source: '@[\\w-]+' },
  { type: 'attr', source: '[\\w-]+(?=\\s*:)' },
  { type: 'tag', source: '[.#][\\w-]+' },
  { type: 'number', source: '\\b\\d+(?:\\.\\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\\b' }
];

const SQL = [
  { type: 'comment', source: '--[^\\n]*' },
  { type: 'comment', source: '/\\*[\\s\\S]*?\\*/' },
  { type: 'string', source: "'(?:[^']|'')*'" },
  { type: 'keyword', source: '\\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|'
      + 'join|left|right|inner|outer|on|group|by|order|having|limit|offset|as|distinct|count|sum|'
      + 'case|when|then|else|end|is|null|in|exists|union|all|create|table|alter|drop|index|'
      + 'primary|key|foreign|references|default|constraint|view|procedure|function|begin|commit|'
      + 'rollback|declare|if|while|return)\\b', flags: 'i' },
  { type: 'number', source: '\\b\\d+(?:\\.\\d+)?\\b' }
];

const PY = [
  { type: 'comment', source: '#[^\\n]*' },
  { type: 'string', source: '"""[\\s\\S]*?"""' },
  { type: 'string', source: "'''[\\s\\S]*?'''" },
  { type: 'string', source: '"(?:[^"\\\\\\n]|\\\\.)*"' },
  { type: 'string', source: "'(?:[^'\\\\\\n]|\\\\.)*'" },
  { type: 'keyword', source: '\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|'
      + 'except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|'
      + 'try|while|with|yield|self|None|True|False)\\b' },
  { type: 'number', source: '\\b\\d+(?:\\.\\d+)?\\b' },
  { type: 'function', source: '[A-Za-z_][\\w]*(?=\\s*\\()' }
];

const SHELL = [
  { type: 'comment', source: '(?:^|\\s)#[^\\n]*' },
  { type: 'string', source: '"[^"]*"' },
  { type: 'string', source: "'[^']*'" },
  { type: 'keyword', source: '\\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|'
      + 'return|exit|local|export|source|echo|set|cd|npm|npx|node|git|yarn|pnpm)\\b' },
  { type: 'attr', source: '\\s-{1,2}[\\w-]+' }
];

const DIFF = [
  { type: 'add', source: '^\\+[^\\n]*' },
  { type: 'del', source: '^-[^\\n]*' },
  { type: 'hunk', source: '^@@[^\\n]*' }
];

const PLAIN = [];

const LANG_ALIASES = {
  js: JS, jsx: JS, mjs: JS, cjs: JS, ts: JS, tsx: JS, typescript: JS, javascript: JS, vue: JS,
  json: JS, jsonc: JS, java: JS, kotlin: JS, scala: JS, swift: JS, dart: JS, go: JS, rust: JS,
  php: JS, csharp: JS, cs: JS, less: CSS,
  html: MARKUP, htm: MARKUP, xml: MARKUP, svg: MARKUP, wxml: MARKUP,
  css: CSS, scss: CSS, sass: CSS, styl: CSS,
  sql: SQL, mysql: SQL, pgsql: SQL, oracle: SQL, plsql: SQL,
  py: PY, python: PY,
  sh: SHELL, bash: SHELL, shell: SHELL, zsh: SHELL, pwsh: SHELL, powershell: SHELL, ps1: SHELL,
  diff: DIFF, patch: DIFF
};

const EXT_LANG = {
  js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', jsx: 'js', vue: 'vue', json: 'json',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml', wxml: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'css',
  sql: 'sql', plsql: 'sql', prc: 'sql', pck: 'sql', fnc: 'sql', trg: 'sql', vw: 'sql',
  py: 'py', sh: 'sh', bash: 'sh', ps1: 'pwsh', cmd: 'sh', bat: 'sh',
  java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', php: 'php', cs: 'cs', dart: 'dart',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', diff: 'diff', patch: 'diff'
};

const cache = new Map();

function compile(list) {
  if (!list.length) return null;
  const source = list.map((rule, i) => `(?<r${i}>${rule.source})`).join('|');
  const flags = `gy${list.some((rule) => rule.flags) ? 'i' : ''}`;
  return { re: new RegExp(source, flags), types: list.map((rule) => rule.type) };
}

function rulesOf(lang) {
  const key = String(lang || '').toLowerCase().trim();
  if (!cache.has(key)) cache.set(key, compile(LANG_ALIASES[key] || PLAIN));
  return cache.get(key);
}

/** 从文件路径推断语言。 */
function langFromFile(file) {
  const match = String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? EXT_LANG[match[1]] || '' : '';
}

/**
 * @param {string} code
 * @param {string} [lang]
 * @returns {Array<{type:string, text:string}>}
 */
function highlight(code, lang) {
  const source = String(code ?? '');
  const compiled = rulesOf(lang);
  if (!compiled) return source ? [{ type: 'plain', text: source }] : [];

  const tokens = [];
  const re = compiled.re;
  let pos = 0;
  let plain = 0;
  while (pos < source.length) {
    re.lastIndex = pos;
    const match = re.exec(source);
    if (!match) {
      pos += 1;
      continue;
    }
    if (pos > plain) tokens.push({ type: 'plain', text: source.slice(plain, pos) });
    const groups = match.groups || {};
    const key = Object.keys(groups).find((name) => groups[name] !== undefined);
    tokens.push({ type: compiled.types[Number(key.slice(1))], text: match[0] });
    pos += match[0].length;
    plain = pos;
  }
  if (plain < source.length) tokens.push({ type: 'plain', text: source.slice(plain) });
  return tokens;
}

module.exports = { highlight, langFromFile, COLORS };
