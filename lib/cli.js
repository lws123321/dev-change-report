/**
 * CLI 主逻辑（不依赖进程启动方式），供 bin/dcr.js 与 SEA 单文件入口共用。
 */
const { buildAll } = require('./export');
const { collectChanges } = require('./changes');
const { installSkill } = require('./install');

const HELP = `dcr —— 代码改动说明文档生成器

安装后无需任何配置：npm i 时已自动把 skill 注册到 ~/.agents/skills/。

用法:
  dcr install [--project] [--force]        手动注册 skill（一般不需要）
         --project   装到当前项目而非用户目录
         --force     覆盖已存在的版本

  dcr build --input <fragment.html>        生成富文本报告
         [--outdir ./change-report]        输出目录（HTML/Word/Excel 同目录）
         [--repo-root .]                   data-code-file 的解析根目录
         [--docx]                         同时导出 Word
         [--xlsx]                         同时导出 Excel 明细表（导入模板格式）
         [--code-text]                    代码块用带底色的文本，不截图
                                          默认是截图（审阅要求图文并茂）

  dcr changes --repo <路径> [--repo …]     收集 git 改动清单
         [--base origin/release]          对比基线（省略自动探测）
         [--json changes.json]            导出 JSON

示例:
  dcr changes --repo . --base origin/release
  dcr build --input report.fragment.html --repo-root .
  dcr build --input report.fragment.html --repo-root . --docx --xlsx
  dcr build --input report.fragment.html --repo-root . --docx --code-text`;

function parseArgs(argv) {
  const args = { repos: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (key === 'repo') {
      if (value && !value.startsWith('--')) { args.repos.push(value); i += 1; }
    } else if (value === undefined || value.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

const version = () => global.__DCR_VERSION__ || require('../package.json').version;

/**
 * @param {string[]} argv 不含 node 与脚本路径的参数
 * @param {{print?:(s?:string)=>void}} [io]
 * @returns {number} 退出码
 */
function run(argv, io = {}) {
  const print = io.print || ((line = '') => process.stdout.write(`${line}\n`));
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (command === '--version' || command === '-v' || command === 'version') {
    print(version());
    return 0;
  }

  if (!command || command === 'help' || command === '--help' || args.help) {
    print(HELP);
    return 0;
  }

  try {
    if (command === 'install') {
      installSkill({ project: args.project === true, force: args.force === true, log: print });
      return 0;
    }

    if (command === 'build') {
      if (!args.input) {
        print('缺少 --input <fragment.html>，用 dcr help 查看用法');
        return 1;
      }
      // HTML / Word / Excel 统一落同一个目录，三个产物不会散在两处
      const outdir = args.outdir || './change-report';
      print('处理代码块：');
      const result = buildAll({
        input: args.input,
        outdir,
        repoRoot: args.repoRoot,
        docx: args.docx === true || args.xlsx === true,
        xlsx: args.xlsx === true,
        codeImage: args.codeText !== true,
        log: print
      });

      print('');

      for (const item of result.files) {
        const extra = item.rows !== undefined ? `，${item.rows} 条明细` : '';
        print(`  -> ${item.file} (${Math.round(item.bytes / 1024)} KB${extra})`);
      }
      print('粘贴方式：编辑器切到「源码」模式，粘入 report.html 全文，再切回可视化。');
      if (result.xlsx) print('提示：导入工具若只认 .xls，在 Excel 里另存为「Excel 97-2003 工作簿」。');
      return 0;
    }

    if (command === 'changes') {
      collectChanges({ repos: args.repos, base: args.base, json: args.json, log: print });
      return 0;
    }

    print(`未知命令: ${command}\n`);
    print(HELP);
    return 1;
  } catch (error) {
    print(`\n出错: ${error.message}`);
    return 1;
  }
}

module.exports = { run, version, HELP };
