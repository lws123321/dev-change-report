/**
 * 收集 git 改动清单，供撰写「改动说明」时对照。
 * 不指定 base 时自动探测：origin/release → origin/master → origin/main → origin/develop → HEAD~10。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = (repo, args) => {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
};

const detectBase = (repo) => {
  for (const candidate of ['origin/release', 'origin/master', 'origin/main', 'origin/develop']) {
    if (git(repo, ['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return 'HEAD~10';
};

const parseNumstat = (text) => text.split('\n')
  .filter((line) => line.trim())
  .map((line) => {
    const [added, deleted, file] = line.split('\t');
    if (!file) return null;
    return {
      path: file,
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted)
    };
  })
  .filter(Boolean);

const parseStatus = (text) => text.split('\n')
  .filter((line) => line.trim())
  .map((line) => ({ code: line.slice(0, 2).trim(), path: line.slice(3).trim() }));

/**
 * @param {object} options
 * @param {string[]} options.repos 仓库路径
 * @param {string} [options.base]  对比基线，省略则自动探测
 * @param {string} [options.json]  导出 JSON 的路径
 * @param {(s:string)=>void} [options.log]
 */
function collectChanges(options) {
  const repos = (options.repos || []).filter(Boolean);
  if (!repos.length) throw new Error('至少需要一个仓库路径');
  const log = options.log || (() => {});
  const report = { generatedAt: new Date().toISOString(), repos: [] };

  for (const repoArg of repos) {
    const repo = path.resolve(repoArg);
    if (!fs.existsSync(repo)) {
      log(`跳过不存在的路径: ${repo}`);
      continue;
    }
    const name = path.basename(repo);
    const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) || '(unknown)';
    const head = git(repo, ['log', '-1', '--format=%h %s']) || '';
    const base = options.base || detectBase(repo);
    const files = parseNumstat(git(repo, ['diff', '--numstat', `${base}...HEAD`]));
    const uncommitted = parseStatus(git(repo, ['status', '--porcelain', '--untracked-files=all']));

    report.repos.push({ name, path: repo, branch, head, base, files, uncommitted });

    log(`\n=== ${name} (${branch}) ===`);
    log(`HEAD: ${head}`);
    log(`BASE: ${base}`);
    if (!files.length) {
      log('  分支内暂无已提交改动');
    } else {
      const added = files.reduce((sum, f) => sum + (f.added || 0), 0);
      const deleted = files.reduce((sum, f) => sum + (f.deleted || 0), 0);
      log(`  已提交改动 ${files.length} 个文件，+${added} / -${deleted}`);
      for (const file of files) {
        const stat = file.added === null ? 'binary' : `+${file.added}/-${file.deleted}`;
        log(`    ${stat.padEnd(12)} ${file.path}`);
      }
    }
    if (uncommitted.length) {
      log(`  工作区未提交 ${uncommitted.length} 项`);
      for (const item of uncommitted) log(`    [${item.code}] ${item.path}`);
    }
  }

  if (options.json) {
    const out = path.resolve(options.json);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    log(`\nJSON 已写入: ${out}`);
  }
  return report;
}

/**
 * 分支内新增的文件（相对路径，正斜杠）。
 * Excel 的「类别」靠它把新写的文件判成「新增程序」，没写 data-category 也不至于全变成「程序修正」。
 * 不是 git 仓库、或包装了 git 拿不到结果时返回空集合，调用方自己兜底。
 */
function addedFiles(repo, base) {
  const root = path.resolve(repo);
  const set = new Set();
  const against = base || detectBase(root);
  for (const line of git(root, ['diff', '--name-status', `${against}...HEAD`]).split('\n')) {
    const cols = line.split('\t').map((s) => s.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    // 状态码可能是 A / A100 / R100（重命名），取最后一列的新路径
    if (/^(A|C)/.test(cols[0])) set.add(cols[cols.length - 1].replace(/\\/g, '/'));
  }
  for (const line of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n')) {
    const file = line.trim().replace(/\\/g, '/');
    if (file) set.add(file);
  }
  return set;
}

module.exports = { collectChanges, detectBase, addedFiles };
