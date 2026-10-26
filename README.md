# dev-change-report

把代码改动或技术实践整理成**可直接粘贴的富文本文档**。代码块默认为带文件路径和行号的截图，
编辑器源码模式粘一次就成型，不用手工截图、不用逐张上传。

能导出三种文件：

| 文件 | 用途 |
|---|---|
| `report.html` | 粘进 OA / 飞书 / CKEditor |
| `report.docx` | Word 文档 |
| `report.xlsx` | Excel 明细表，版式对齐 OA 导入模板，一行一个文件路径 |

**代码块默认渲染成截图**，带文件路径、行号和语法高亮。开发描述要过审阅，纯文字代码块容易被判「不够图文并茂」，所以默认走图。
想要可选中、可搜索的文本代码块，加 `--code-text`（同样带高亮）。

两种模式：

| 模式 | 用途 | 语气 |
|---|---|---|
| 开发改动说明 | 评审、交付、归档。交代「改了什么」 | 客观、要点先行 |
| 知识分享文章 | 团队分享、技术沉淀、复盘 | 第一人称、讲过程 |

- 片段只写语义标签，样式自动注入，观感统一
- 代码自动从真实文件按行截取，不手抄、不用转义
- 代码块默认带路径、行号和语法高亮的截图，满足图文并茂要求
- 同时产出 HTML / Word / Excel，一份片段三种交付

## 安装

### 装进项目（推荐）

```bash
npm i -D dev-change-report
```

装完 skill 会自动注册到 `~/.agents/skills/`，**重启编辑器**即可使用。

升级只需改版本号，skill 跟着更新：

```bash
npm i -D dev-change-report@latest
```

### 不装进项目，直接用 npx

```bash
npx dev-change-report build --input report.fragment.html --repo-root . --docx --xlsx
```

`npx` 会把包装到 npm 缓存里临时执行，**不改你的 `package.json`**，连 `npm i` 都省了。
包里带 postinstall，所以 skill 照样会注册，对话里仍然能直接说「整理一下这次改动」。

`npx dcr` 是等价的短写法（`dcr` 是包里的 bin 名）。

### 两者选哪个

| | `npm i -D` | `npx` |
|---|---|---|
| 改 `package.json` | 会写进 devDependencies | 不写 |
| 版本 | 锁在 lockfile 里，团队一致 | 每次可能拿到最新版 |
| 磁盘 | 占项目 `node_modules` | 只占 npm 缓存 |
| 离线可用 | 是 | 缓存过才行 |
| 注册 skill | 是 | 是（postinstall） |

团队里几个人要出同一种格式的文档 → `npm i -D`；只是自己想跑一次 → `npx`。

## 怎么用

不用记命令，**直接对 AI 说一句话**。它会自己读 git 改动、挑代码、生成 HTML。

### 开发改动说明

| 你想做什么 | 可以这么说 |
|---|---|
| 整理本次改动 | 整理一下这次改动 |
| 指定对比基线 | 整理 feat_bill 相对 release 的改动 |
| 多仓库一起整理 | 整理 ras-ui-mobile 和 ras-ui 这两个仓库的改动 |
| 交付给业务方 | 生成本次需求交付文档，要能粘到 OA |
| 先看看改了啥 | 先列出这次改了哪些文件 |

### 知识分享文章

| 你想做什么 | 可以这么说 |
|---|---|
| 写一篇分享 | 把这次改动写成知识分享 |
| 复盘 | 复盘一下这次怎么做的 |
| 专题文章 | 写篇技术文章讲讲这个工具怎么封装的 |
| 踩坑记录 | 讲讲这次踩了哪些坑 |

知识分享模式内置了一套写作约束（口吻、结构、避免 AI 写作痕迹），
详见 [`SKILL.md`](SKILL.md) 的「模式 B」一节。生成后会自己对照自查清单过一遍。

### 想要 Word 或 Excel

| 你想做什么 | 可以怎么说 |
|---|---|
| 要一份 Word | 导出成 word 给我 |
| 顺手都给 | 开发描述 + word + excel 都来一份 |
| 走 OA 导入 | 生成导入模板格式的 excel 明细 |
| 代码用文字不用图 | 代码块用文本就行，不要截图 |

Word 落在 `change-report/` 目录，和 HTML 在一起。代码块默认是截图，带文件路径和行号。
Excel 只在开发改动说明模式产出：**一行一个文件**，「明细内容」列填路径，「备注」列写一句短说明。所以文档正文里不再需要单列一节文件清单。

### 一次完整对话

> **你**：帮我整理一下这次改动，输出开发描述，要能粘到 OA 里
>
> **AI**：已生成 `change-report/report.html`，6 个章节、11 段代码块。
> 打开后全选复制，OA 编辑器切到「源码」模式粘贴即可。

中间它会自动做这些事，不需要你干预：

1. 跑 `dcr changes` 确认分支、提交和文件清单
2. 读关键 diff，把每个要点写成「原问题 → 怎么改 → 改后效果」
3. 按行号引用真实文件，只截能说明问题的 8~25 行
4. 调 `dcr build` 生成最终 HTML

### 觉得不满意可以继续提

- 代码块太多了，只留最核心的 3 段
- 加一节上线注意事项
- 这个报错的根因写清楚一点
- 文件清单用相对路径，别写绝对路径
- 那处配置改动用 diff 展示前后对比

AI 会基于已有片段调整后重新生成，不用从头再来。

## 手动执行（进阶）

想自己控制每一步时，用下面四条命令。

### 1. 收集改动

```bash
npx dcr changes --repo . --base origin/release
```

输出分支、HEAD、文件清单与增删行数，并列出工作区未提交改动。
省略 `--base` 会自动探测基线。加 `--json changes.json` 可导出结构化清单。

### 2. 写片段

新建 `report.fragment.html`，只写标签，不写样式：

```html
<h2>一、选择柜组件优化</h2>

<h3>1.1 默认搜索条件与 PC 对齐</h3>
<p>原问题：默认按实际柜号搜索且发货日期写死当天，柜的发货时间普遍早于当天，必然空结果。</p>
<pre data-code-file="src/views/qbcrm/blRelease/Form.vue" data-code-range="56-79"></pre>
<p tip="info">改后效果：打开即有数据，输入提示随字段联动。</p>
```

| 写法 | 用途 |
|---|---|
| `<h2>` / `<h3>` | 一级章节 / 二级标题 |
| `<h2 data-category="新增程序">` | 指定该章节的 Excel 类别 |
| `<h3 data-files="a.ts,b.ts">` | 补上本节涉及、但没贴代码的文件（进 Excel 明细内容列） |
| `<p>` | 正文 |
| `<p tip="info\|warn\|danger">` | 提示块（绿 / 黄 / 红） |
| `<table><tr><th>…<td>…` | 表格，不要写 border 或 style |
| `<ul><li>` | 列表 |
| `<code>` | 行内代码 |
| `<pre data-code-file="…" data-code-range="…">` | 从文件按行截取（推荐） |
| `<pre data-code-lang="text">…</pre>` | 内嵌代码，需转义 `<` `>` `&` |

`data-code-range` 是 1-based 闭区间（如 `56-79`），省略则取全文。

### 3. 生成

```bash
npx dcr build --input report.fragment.html --repo-root . --docx --xlsx
```

产物都在 `change-report/` 下：

- `change-report/report.html`
- `change-report/report.docx`
- `change-report/report.xlsx`（仅开发改动说明模式需要）

### 4. 粘贴 / 交付

HTML：打开 `report.html`，全选复制 → 编辑器切到「源码」模式 → 粘贴 → 切回可视化。

Word / Excel 直接发附件。

## 命令总览

```
dcr build --input <fragment.html>     生成 report.html
      [--outdir ./change-report]      三个产物的输出目录
      [--repo-root .]                 data-code-file 的解析根
      [--docx]                        同时导出 Word
      [--xlsx]                        同时导出 Excel 明细表
      [--code-text]                   代码块用文本，不截图

dcr changes --repo <路径> [--repo …]  收集 git 改动清单
      [--base origin/release]
      [--json changes.json]

dcr install [--project] [--force]     重新注册 skill（一般不需要）
dcr --version                         查看版本
dcr help                              查看帮助
```

## 安装选项

通常不需要手动干预，以下是特殊场景：

```bash
npx dcr install             # 重新注册（幂等，内容相同则不写盘）
npx dcr install --project   # 装到 ./.agents/skills/，跟着仓库走
npx dcr install --force     # 强制覆盖
```

| 环境变量 | 作用 |
|---|---|
| `DCR_SKIP_INSTALL=1` | 跳过自动注册（CI 里常用） |
| `DCR_SKILLS_DIR=<路径>` | 自定义 skills 根目录 |

如果公司 npm 配置了 `--ignore-scripts`，`postinstall` 不会执行，
装完手动跑一次 `npx dcr install` 即可。

## 常见问题

**代码块显示成一行？**
`<pre>` 依赖 `white-space:pre-wrap`。若编辑器剥离了内联样式，把生成的 `<pre>` 内容重新粘贴一次，或换用支持内联样式的编辑器（飞书文档、新版 CKEditor 均可）。

**`data-code-file` 报文件不存在？**
检查 `--repo-root` 是否指向代码仓库根目录。引用其他仓库的文件用相对路径，如 `../another-repo/src/a.ts`。

**表格没有边框？**
片段里不要给 `<table>` 写 `border` 属性，交给脚本注入边框样式。

**Word 里代码块是图片，能改文字吗？**
改不了。要改内容就改片段重新导出。不想要图片就加 `--code-text`，代码会变成带底色的等宽文本。

**Excel 导入报错说格式不对？**
导出的是 `.xlsx`。如果导入工具只认老的 `.xls`，在 Excel 里「另存为 Excel 97-2003 工作簿」再导。

**Excel 里小类、模组、语言怎么填？**
「小类」按文件类型自动匹配（`.vue` / `.ts` → `WEB（前端）`，`.java` → `JAVA（后端）`，`.sql` → `PROCEDURE（过程）`，认不出的归 `OTHERS（另外）`），带下拉框可改。「类别」也自动判：分支内新增的文件算 `新增程序`，数据脚本算 `数据修正`，其余按标题关键词判。**「模组」「语言」两列是空的**，留给导入方按实际情况填。
想强制指定类别，在片段的 `<h2>` 上写 `data-category`，写了就完全听它的。

**Excel 只出了几行，少了一些章节？**
没引用任何文件的章节不会进表（明细内容列填不出路径）。如果某节确实改了文件，在该 `<h3>` 上补 `data-files="路径"`。

**装完没有自动注册 skill？**
先确认版本 `npm ls dev-change-report`。刚发布的新版本可能有 5 分钟 CDN 缓存，
装到旧版就是旧行为，等一会儿重装或手动 `npx dcr install`。

## License

MIT © Linweisong
