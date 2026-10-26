/**
 * SEA 入口：node 单文件可执行程序从这里启动。
 * 该文件会被 tools/bundle.js 内联，不要 require 任何相对路径以外的资源。
 */
const { run } = require('./cli');

process.exitCode = run(process.argv.slice(2));
