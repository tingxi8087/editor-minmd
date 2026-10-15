# 实现现状

核对日期：2026-10-15。依据当前源码、项目配置，以及本次会话此前执行的测试和 macOS 桌面验收。本文整理没有重新运行构建或测试。

## 当前可用链路

在 Tauri 桌面窗口通过原生文件对话框打开本地 Markdown，直接编辑排版后的正文，手动保存或另存为，再次打开能够读取保存的内容。当前是单文档工作台。

## 已实现

| 范围 | 当前行为 | 源码入口 |
| --- | --- | --- |
| 新建、打开、保存 | 新建未命名文档；原生打开/保存对话框；保存回原文件、另存为；取消对话框不执行写入 | [App.tsx](../src/App.tsx)、[files.ts](../src/lib/files.ts)、[lib.rs](../src-tauri/src/lib.rs) |
| 文件读取 | 打开过滤器包含 md、markdown、mdown；读取 UTF-8，读取前限制为 16 MB 以内；处理中文名与空格路径 | [lib.rs](../src-tauri/src/lib.rs) |
| 所见即所得 | Tiptap 文档编辑，正文、H1—H6、粗斜体、删除线、列表、任务、引用、代码块、基础表格 | [extensions.ts](../src/components/DocumentEditor/extensions.ts)、[App.tsx](../src/App.tsx) |
| 格式工具栏 | 段落格式、撤销重做、粗斜体、删除线、三类列表、引用、代码块、插入表格 | [App.tsx](../src/App.tsx) |
| 代码高亮 | 文档内代码块使用 Lowlight / Highlight.js 常用语言集合 | [extensions.ts](../src/components/DocumentEditor/extensions.ts) |
| 文档导航 | 左侧标题大纲、点击滚动定位；切换文档后回到正文顶部 | [App.tsx](../src/App.tsx) |
| 阅读和原文 | 阅读模式关闭编辑；原文弹窗只读展示未改原文或当前编辑内容的 Markdown | [App.tsx](../src/App.tsx) |
| 修改与离开保护 | 修改标记；新建、打开其他文件、关闭窗口时提供继续编辑、不保存、保存并继续 | [App.tsx](../src/App.tsx) |
| 编辑会话隔离 | 打开另一文档重置撤销历史；阅读状态变化不触发正文更新 | [session.ts](../src/components/DocumentEditor/session.ts) |
| 保存冲突 | 保存时对比原始快照，文件被外部改动或删除时拒绝覆盖 | [lib.rs](../src-tauri/src/lib.rs) |
| 文件写入 | 同目录临时文件、保留原文件权限、同步后替换；返回本次保存内容快照 | [lib.rs](../src-tauri/src/lib.rs) |
| Markdown 文件封装 | 识别并保留 Frontmatter、BOM、LF/CRLF 类型及末尾换行有无；无修改时普通保存不重写文件 | [markdown.ts](../src/lib/markdown.ts)、[App.tsx](../src/App.tsx) |
| 特殊语法保护 | 检出的脚注、数学块、内嵌 HTML、提示块和部分自定义语法、未闭合围栏改为只读原文展示 | [markdown.ts](../src/lib/markdown.ts) |
| 紧凑纸墨外观 | 主题、侧栏显隐；全宽正文；缩小工具区、段落和任务间距；偏好持久化于 localStorage | [global.less](../src/global.less)、[正文样式](../src/components/DocumentEditor/index.module.less)、[settings.ts](../src/store/settings.ts) |
| macOS 合并标题栏 | 原生关闭/最小化/全屏按钮与文件操作同一行，空白处可拖动，显示文件名与未保存状态 | [窗口配置](../src-tauri/tauri.conf.json)、[权限](../src-tauri/capabilities/default.json)、[App.tsx](../src/App.tsx) |
| 基础项目交付 | MIT 文件、源码依赖锁文件、开发说明、示例 Markdown、macOS 本地调试应用包 | [LICENSE](../LICENSE)、[README](../README.md)、[示例](../examples/纸墨试写.md) |

快捷键：⌘/Ctrl + N 新建，⌘/Ctrl + O 打开，⌘/Ctrl + S 保存，⌘/Ctrl + Shift + S 另存为。

## 部分实现，不能视为完整功能

| 能力 | 已有基础 | 尚缺部分 |
| --- | --- | --- |
| 文本/代码编辑 | Markdown 中的代码块高亮 | 普通文件编辑、CodeMirror、语言切换、行号、搜索等 |
| 源码模式 | 原文只读弹窗 | 可编辑的 Markdown 源码和与 Tiptap 的模式转换 |
| 标签栏 | 当前文件的标签外观 | 多文件会话、标签切换/关闭/排序和独立撤销 |
| 链接 | StarterKit 的链接 schema 和输入规则；点击不会直接打开 | 插入/编辑链接弹窗、完整访问交互 |
| 图片 | Image 扩展可承载 Markdown 图片节点 | 本地相对路径解析、粘贴/拖入、附件保存、完整预览 |
| 表格 | 插入 3×3 带表头表格、编辑单元格 | 行列管理和对齐的操作入口；当前未提供列宽调整 |
| 代码块 | 语法高亮、输入围栏创建 | 语言选择 UI、复制按钮 |
| 外部修改 | 写入前快照比较 | 实时监听、未修改时自动重载、对比/合并界面 |
| 跨平台桌面 | Tauri 工程与桌面图标 | Windows/Linux 实际构建验收、对应单行标题栏适配 |
| 第三方许可 | 顶层依赖许可索引 | 分发所需全部传递依赖许可全文与自动核对 |

## 当前限制

- 没有目录打开、真实文件树、多标签、拖放文件、最近文件、系统文件关联或命令行打开入口。
- 没有 `/` 菜单、浮动格式栏、标题折叠、查找替换或独立专注模式。
- 没有自动保存、恢复草稿或上次会话恢复；强制结束进程可能丢失未保存内容。窗口关闭保护不等同于覆盖所有操作系统退出场景。
- 只读取 UTF-8，没有 GB18030 等编码选择；文件大小上限不是 16 MB 文档编辑性能保证。
- 特殊语法检测基于规则，不是完整 Markdown 方言识别；可能保守拦截，也不保证识别所有未知语法。
- 编辑后可能规范化表格、空行等；混合换行会按检测到的类型统一，末尾多空行数量不承诺保留。
- 保存前比较与替换之间没有跨进程文件锁，不能宣称消除了所有并发写入竞态。
- 没有自定义背景、字体/字号/行高设置界面；文档字体颜色等功能按设计排除。
- macOS 原生红黄绿按钮未删除。此前截图中被系统屏幕共享指示条遮挡；本次整理未新增窗口按钮可见性验收。
- 当前有本地 macOS 调试 `.app`，尚无正式签名、公证、Windows/Linux 发布包或公开发布验证。

## 验证记录及范围

以下结果均来自 2026-10-15 本会话的实际工具输出。后续代码变化后应按影响范围重验。

| 验证 | 当时结果 | 实际覆盖 |
| --- | --- | --- |
| `npm test` | 2 个测试文件，6 项通过 | Markdown 封装和结构往返、特殊语法保护、编辑/撤销/重做、跨文件历史隔离、切换编辑状态不改内容 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 3 项通过 | 中文 Markdown 文件读写/BOM/CRLF、冲突及删除保护、新文件和无效 UTF-8 |
| `npm run build` | 通过 | TypeScript 和 Vite 生产资源构建；最新标题栏打包时再次执行通过 |
| `npx tauri build --debug --bundles app` | 通过 | macOS 本地调试 `.app`；最新标题栏版本已打包 |
| 原生窗口人工操作 | 通过 | 中文文件打开、勾选任务、追加正文、保存、磁盘核对、重新打开；新建前未保存提示、外部改动拒绝覆盖、另存为 |
| 界面检查 | 已检查 | 浅色/深色纸墨、紧凑布局、标题栏合并、拖动操作和打开按钮；没有完整小窗口/跨平台矩阵 |

最近一次自动测试早于后续布局和标题栏调整；后续调整完成了构建和桌面检查，没有把旧自动测试结果当作最新全量回归。

[测试源码](../tests/)与 [Rust 测试](../src-tauri/src/lib.rs)是覆盖范围依据。`artifacts/` 中验收文件和截图被 Git 忽略，不作为源码分发必需项；文档目录已保留一张[当前界面截图](images/current-desktop.png)。

## 主要源码入口

```text
src/App.tsx                              单文档会话与工作台交互
src/components/DocumentEditor/           编辑器扩展、切换文档与正文样式
src/lib/files.ts                        Tauri 调用边界
src/lib/markdown.ts                     Markdown 封装与保护
src/store/settings.ts                   外观偏好
src/global.less                         全局布局与主题
src-tauri/src/lib.rs                     原生对话框与文件读写
src-tauri/tauri.conf.json                桌面窗口和打包
```
