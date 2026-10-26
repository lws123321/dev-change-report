/**
 * 把 SKILL.md 安装到 agent 能识别的 skills 目录。
 *
 * 个人级（默认）: <home>/.agents/skills/dev-change-report/SKILL.md   —— 所有项目可用
 * 项目级（--project）: <cwd>/.agents/skills/dev-change-report/SKILL.md —— 跟着仓库走
 *
 * SKILL.md 的来源优先级：
 *   1. options.content         调用方直接给内容
 *   2. global.__DCR_SKILL_MD__ 打包进 exe 的内嵌副本
 *   3. 包内 SKILL.md             npm 安装场景
 *
 * 三种调用场景：
 *   - postinstall 自动安装：内容相同则完全静默，不同则覆盖（升级路径）
 *   - dcr install：显式执行，输出完整提示
 *   - dcr install --force：强制重写
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_NAME = 'dev-change-report';
const PACKAGE_ROOT = path.join(__dirname, '..');

/**
 * skills 根目录。
 * DCR_SKILLS_DIR 可整体覆盖，便于在沙箱/CI 里验证而不污染真实用户目录。
 */
const targetDir = (useProject) => {
  const override = String(process.env.DCR_SKILLS_DIR || '').trim();
  if (override) return path.join(override, SKILL_NAME);
  return path.join(useProject ? process.cwd() : os.homedir(), '.agents', 'skills', SKILL_NAME);
};

function readSkillMarkdown(explicit) {
  if (explicit) return explicit;
  if (typeof global.__DCR_SKILL_MD__ === 'string') return global.__DCR_SKILL_MD__;
  const source = path.join(PACKAGE_ROOT, 'SKILL.md');
  if (fs.existsSync(source)) return fs.readFileSync(source, 'utf8');
  throw new Error('找不到 SKILL.md，请确认安装完整');
}

/**
 * @param {object} options
 * @param {boolean} [options.project] true 装到当前项目，false 装到用户目录
 * @param {boolean} [options.force]   已存在且内容不同时也覆盖；内容相同永远跳过写入
 * @param {string}  [options.content] 直接指定 SKILL.md 内容
 * @param {boolean} [options.quiet]   内容无变化时不输出（postinstall 用）
 * @param {(s:string)=>void} [options.log]
 * @returns {{dir:string, written:boolean, existed:boolean, skipped:boolean}}
 */
function installSkill(options = {}) {
  const log = options.log || (() => {});
  const content = readSkillMarkdown(options.content);
  const dir = targetDir(options.project);
  const target = path.join(dir, 'SKILL.md');
  const existed = fs.existsSync(target);
  const unchanged = existed && fs.readFileSync(target, 'utf8') === content;

  // 内容一致就没必要写盘，也不打扰用户。
  if (unchanged) {
    if (!options.quiet) {
      log(`已是最新: ${target}`);
    }
    return { dir, written: false, existed: true, skipped: true };
  }

  // 已存在且内容不同：force 或 quiet（postinstall 升级场景）时覆盖
  if (existed && !options.force && !options.quiet) {
    log(`已存在，未覆盖: ${target}`);
    log('如需更新，加 --force');
    return { dir, written: false, existed: true, skipped: false };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  log(`${existed ? '已更新' : '已安装'}: ${target}`);
  if (!options.quiet) {
    log('');
    log('下一步：重启编辑器，然后对它说「整理一下这次改动」即可触发。');
  }
  return { dir, written: true, existed, skipped: false };
}

module.exports = { installSkill, SKILL_NAME };
