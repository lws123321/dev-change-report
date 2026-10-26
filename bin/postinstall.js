#!/usr/bin/env node
/**
 * postinstall 钩子：npm i 时自动把 skill 注册到 ~/.agents/skills/。
 *
 * 设计约束：
 *   - 永不失败。任何异常都吞掉并退出码 0，不能因为装 skill 失败而破坏 npm i。
 *   - 内容一致时完全静默，不给每次 npm i 都刷屏。
 *   - 用 DCR_SKIP_INSTALL=1 可跳过（CI、或不想污染用户目录时）。
 *   - 只装用户级（~/.agents/skills）。项目级请手动 dcr install --project。
 */
let installSkill;

try {
  ({ installSkill } = require('../lib/install'));
} catch (error) {
  // lib 缺失说明包损坏，交给 npm 的完整性校验处理，这里不发声。
  process.exit(0);
}

const skip = String(process.env.DCR_SKIP_INSTALL || '') === '1';
if (skip) process.exit(0);

// npm run 时会带上大量 npm_config_*，取 loglevel 判断是否静默
const silent = /silent|error/.test(String(process.env.npm_config_loglevel || ''));

try {
  const result = installSkill({
    quiet: true,
    force: true,
    log: silent ? () => {} : (line) => process.stdout.write(`[dev-change-report] ${line}\n`)
  });

  if (result.written && !silent) {
    process.stdout.write(
      '[dev-change-report] skill 已就绪，重启编辑器后对 AI 说「整理一下这次改动」即可触发。\n'
    );
  }
} catch (error) {
  // 无写权限（如只读 HOME、受限沙箱）时静默降级，提示手动安装。
  if (!silent) {
    process.stdout.write(
      '[dev-change-report] 自动注册 skill 失败，请稍后手动执行: npx dcr install\n'
    );
  }
}

process.exit(0);
