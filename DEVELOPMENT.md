# 开发说明

本文档面向维护者，不随 npm 包发布（`package.json` 的 `files` 未包含它）。

## 目录结构

```
├── bin\
│   ├── dcr.js            CLI 入口，只做一件事：调 lib/cli.run
│   └── postinstall.js    npm i 时自动注册 skill
├── lib\
│   ├── cli.js            参数解析、子命令分发、帮助文本
│   ├── build.js          片段 → 富文本 HTML（STYLE / TIP 样式字典在这里）
│   ├── export.js         Word / Excel 导出的调度层
│   ├── html-blocks.js    片段 HTML → 节点树（docx / xlsx 共用）
│   ├── docx.js           OOXML：段落、表格、提示块、代码图片/文本
│   ├── render.js         代码 → PNG 的调度（临时文件、manifest、读回）
│   ├── render-code.ps1   代码 → PNG 的实际渲染（Windows GDI+，支持批量）
│   ├── highlight.js      语法着色（`--code-text` 时用）
│   ├── xlsx.js           SpreadsheetML：对齐 OA 导入模板
│   ├── zip.js            极简 ZIP 写入器（zlib deflate，docx/xlsx 共用）
│   ├── changes.js        git 改动收集
│   ├── install.js        SKILL.md 写入 skills 目录
│   └── sea-entry.js      exe 打包入口（与 bin/dcr.js 等价）
├── packaging\
│   ├── install.cmd       exe 安装脚本
│   └── sea-config.json   Node SEA 配置
├── tools\
│   ├── bundle.js         极简 CommonJS 打包器（60 行，零依赖）
│   ├── make-exe.js       复制 node.exe + postject 注入 blob
│   └── pack-win.js       打 Windows 分发 zip
├── SKILL.md              给 AI 的技能描述，会被装到 ~/.agents/skills/
└── README.md             面向用户的使用文档
```

## 调整输出样式

`lib/build.js` 顶部两个字典控制全部观感，改完即时生效，不需要动别的地方：

```js
const STYLE = {
  h2: 'font-size:19px;font-weight:600;margin:26px 0 12px;...',
  h3: '...', p: '...', ul: '...', li: '...',
  table: '...', th: '...', td: '...',
  code: '...', pre: '...'
};
const TIP = {
  info: ['#f2f7f4', '#0a7a50'],   // [背景色, 左边框色]
  warn: ['#fdf8e9', '#c99515'],
  danger: ['#fcf0ef', '#c0392b']
};
```

新增标签支持时，把它加进 `build.js` 的 `TAGS` 数组，样式会自动注入。

## 产物生成链路

`dcr build` 走 `export.js` 的 `buildAll`，一次生成全部产物：

```
片段 HTML
  ├─ export.resolveCodeBlocks   代码读出，换成占位（含文件/行号标注）
  ├─ render.js                  → render-code.ps1 → 12 张 PNG
  ├─ build.js                   → report.html（有图用 base64 <img>，无图用 <pre>）
  ├─ docx.js                    → ZIP（zip.js）→ .docx（有图嵌图，无图着色文本）
  └─ xlsx.js                    → ZIP（zip.js）→ .xlsx
```

**代码只读一次、截图只渲一次**，三个产物用同一批图，不会出现「文档里有图、HTML 里是文字」。
`--code-text` 跳过截图渲染，两侧都退回文本。

关键实现细节，改的时候容易踩：

- **ZIP 自己写**：`zlib.deflateRawSync` + 手算 CRC32，不引第三方包。压缩后反而变大时改用 store（method 0）。
- **代码块默认是图片**（`export.js` → `render.js` → `render-code.ps1`）：
  - 一次 PowerShell 渲全部（`-Manifest jobs.json`）。单张单进程的话 10 段代码要等十几秒。
  - **着色在 JS 侧做**：`render.js` 用 `highlight.js` 把代码切成 token，再拆成 `[{t,c}]` 行内片段交给 PowerShell。PS 只管测量和画，不认语法。
  - **按列定位，不累加字宽**：等宽字体下 `x = start × charW`，不依赖逐段测量，否则误差会逐段累积，段间出现空隙。
  - **必须用 `GenericTypographic` + `MeasureTrailingSpaces`**：默认 StringFormat 带行边距，量出来的 `charW` 偏大，按它定位会把整行撞出去。
  - 渲染分辨率是显示尺寸的 **1.5 倍**。2 倍时字更锐利，但 base64 嵌进 HTML 能到 900 KB，粘进编辑器会卡；1.5 倍在 478pt 显示宽度下约 144 DPI，够用。
  - 图片上带「文件路径 + 行号」标注，审阅的人能对着仓库找。
  - **失败不报错**：非 Windows、找不到 PowerShell、渲染失败 → 静默退回文本代码块，文档照常出。
- **代码块是单段落**（文本模式）：整段代码装进一个 `<w:p>`，用 `<w:br/>` 换行。段落底纹只在段落范围生效，拆成「一行一段」会出现段间白缝，看着不像一个整体。
- **制表符要转 `<w:tab/>`**：直接放 `\t` 字符 Word 会吞掉，缩进就丢了。
- **着色在 `highlight.js`**（仅 `--code-text` 模式）：按优先级拼成一个大正则（sticky `y`），从前往后扫，未命中就前进一个字符。不追求语法树，只要关键字/字符串/注释/数字不出错。新增语言只需在 `LANG_ALIASES` 里加一组规则。
- **兜底**：认不出的语言按纯文本渲染，不会报错也不会吞字符（用「拼回去等于原文」验证）。
- **xlsx 版式固定**：第 1 行提醒（合并 A:F）、第 2 行表头、第 3 行起数据。这个行序是 OA 导入校验认的，别动。
- **备注列的文件来源**：`data-code-file`（贴了代码的）+ `data-files`（没贴代码的），后者在 `<h3>` 或 `<h2>` 上声明，`<h2>` 整节继承。`resolveCodeBlocks` 会把 `data-code-file` 带回新的 `<pre>` 上，去掉它 Excel 就收集不到贴了代码的文件。
- **Excel 一行一个文件**：导入模板的「明细内容」列填的是路径，多个文件挤在一行会被当成一条记录。同一文件跨多个改动点时去重（清单性质）。
- **没有文件的章节不进表**：`rowsFromFragment` 会跳过 `files` 为空的组，所以「验证记录」「上线说明」这类章节不会污染明细表。
- **行高交给 Excel**：数据行不写 `ht` / `customHeight`，路径长短不一，写死会被截断。
- **文档正文不列文件清单**：文件信息由 Excel 承载，正文只讲「为什么这么改」。这是刻意的分工，不要又加回一节表格。
- **`.xlsx` 不是 `.xls`**：模板本体是 BIFF8（OLE2 容器），写 BIFF8 不现实。要真出 `.xls` 只能走 Excel COM 另存，那会把跨平台和零依赖两个前提都干掉。

## 发布流程

```bash
# 1. 改版本号（README 变更也要改，npm 页面用的是打包快照）
npm version patch   # 或 minor / major

# 2. 核对包内容
npm pack
tar -tzf dev-change-report-<version>.tgz

# 3. 发布
npm publish

# 4. 等约 5 分钟 CDN 缓存过期后验证
npm view dev-change-report version --registry https://registry.npmjs.org/
```

`package.json` 里的 `publishConfig` 已固定官方源与 public access，
本机 registry 是淘宝镜像也不影响发布。

**注意**：npm 首次发布会生成一个 `0.0.0-stage` 占位版本，属正常流程。
删除它需要带 2FA 的人工操作，绕过 2FA 的 granular token 无此权限：

```bash
npm unpublish dev-change-report@0.0.0-stage --registry https://registry.npmjs.org/
```

## postinstall 的行为约定

`bin/postinstall.js` 有三条硬约束，改动时不要破坏：

1. **永不失败**：全流程 try/catch 且强制 `exit 0`，不能因为写 skill 失败而让 `npm i` 报错
2. **幂等且安静**：内容与已装版本一致时完全静默，不刷屏
3. **可跳过**：`DCR_SKIP_INSTALL=1` 时直接退出

无写权限（受限 HOME、只读沙箱）时降级提示手动安装，不中断安装流程。

npm 7+ 默认隐藏脚本输出，调试时加 `--foreground-scripts`。

## 构建 Windows exe

只在需要「对方机器没装 Node」时构建。需要 Node 20+。

```bash
npm i -D postject
npm run bundle      # lib/ + bin/ → dist/dcr-bundle.js（约 21 KB）
npm run sea:blob    # → dist/sea-prep.blob
node tools/make-exe.js --node "C:\Program Files\nodejs\node.exe"
npm run pack:win    # → dist/dcr-win-x64.zip（约 33 MB）
```

**踩坑记录：**

- `--node` 必须指向真实的 `node.exe`（80 MB 左右）。用 Volta / nvm 时
  `Get-Command node` 拿到的是几 MB 的 shim，postject 注入会失败。
  用 `node -e "console.log(process.execPath)"` 找真实路径。
- SKILL.md 与版本号在 `tools/bundle.js` 里内嵌进 bundle（`global.__DCR_SKILL_MD__`、
  `global.__DCR_VERSION__`），因此 exe 运行时零外部依赖。
- zip 打包用 bsdtar `tar -a -c -f out.zip`，比 PowerShell `Compress-Archive` 稳
  （后者可能加载不了 Archive 模块）。zip 内文件名保持 ASCII，中文名往返会乱码。

exe 体积 83 MB，来源是整个 Node 运行时，SEA 不支持裁剪，这是该方案的上限。

## SKILL.md 的修改

改完必须同步到本机才会生效：

```bash
node bin/dcr.js install --force
```

然后重启编辑器。注意 `DCR_SKILLS_DIR` 环境变量如果残留在终端会话里，
会装到错误位置。
