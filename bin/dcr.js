#!/usr/bin/env node
/**
 * dcr —— dev-change-report 命令行入口
 *
 *   dcr install [--project] [--force]     把 skill 装到 .agents/skills/
 *   dcr build   --input <fragment.html>   生成 report.html
 *   dcr changes --repo <path> [--repo …]  收集 git 改动清单
 */
const { run } = require('../lib/cli');

process.exitCode = run(process.argv.slice(2));
