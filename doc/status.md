# 实现现状

核对日期：2026-10-15。依据当前源码、项目配置、本轮自动测试和 macOS 桌面验收。

## 当前可用链路

在 Tauri 桌面窗口通过原生文件对话框打开本地 Markdown，直接编辑排版后的正文，手动保存或另存为，再次打开能够读取保存的内容。当前支持目录工作台、按层文件树和多标签；打开目录或新文件不会丢弃其他标签的修改。

## 已实现

| 范围 | 当前行为 | 源码入口 |
| --- | --- | --- |
| 新建、打开、保存 | 新建未命名文档；原生打开/保存对话框；保存回原文件、另存为；取消对话框不执行写入 | [App.tsx](../src/App.tsx)、[files.ts](../src/lib/files.ts)、[lib.rs](../src-tauri/src/lib.rs) |
| 目录与文件树 | 原生目录选择、按层展开、目录优先排序、空目录提示、读取错误重试、手动刷新与关闭目录；越界路径被拒绝 | [workspace.rs](../src-tauri/src/workspace.rs)、[FileTree](../src/components/FileTree/index.tsx) |
| 多标签 | 每份文件独立 Editor、正文、修改标记、选区、滚动位置、阅读模式与撤销历史；按规范化路径去重，重复打开激活已有标签 | [model.ts](../src/workspace/model.ts)、[DocumentTabs](../src/components/DocumentTabs/index.tsx) |
| 文件读取 | 打开过滤器包含 md、markdown、mdown；读取 UTF-8，读取前限制为 16 MB 以内；处理中文名与空格路径 | [lib.rs](../src-tauri/src/lib.rs) |
| 所见即所得 | Tiptap 文档编辑，正文、H1—H6、粗斜体、删除线、列表、任务、引用、代码块、基础表格 | [extensions.ts](../src/components/DocumentEditor/extensions.ts)、[App.tsx](../src/App.tsx) |
| 格式工具栏 | 段落格式、撤销重做、粗斜体、删除线、三类列表、引用、代码块、插入表格 | [App.tsx](../src/App.tsx) |
| 代码高亮 | 文档内代码块使用 Lowlight / Highlight.js 常用语言集合 | [extensions.ts](../src/components/DocumentEditor/extensions.ts) |
| 文档导航 | 侧栏切换文件/标题大纲；点击标题定位；切换标签恢复各自滚动位置 | [App.tsx](../src/App.tsx) |
| 阅读和原文 | 阅读模式关闭编辑；原文弹窗只读展示未改原文或当前编辑内容的 Markdown | [App.tsx](../src/App.tsx) |
| 修改与离开保护 | 修改标记；关闭单个/其他标签、关闭窗口和菜单退出时逐份确认；可取消或保存后继续，新建/打开/切换不会替换未保存内容 | [App.tsx](../src/App.tsx) |
| 编辑会话隔离 | 每个标签保留独立编辑器实例及撤销历史，关闭时销毁并释放原生文件登记；阅读状态变化不触发正文更新 | [model.ts](../src/workspace/model.ts) |
| 保存冲突 | 保存时对比原始快照，文件被外部改动或删除时拒绝覆盖；另存为目标若属于其他已打开标签则拒绝写入 | [lib.rs](../src-tauri/src/lib.rs) |
| 文件写入 | 同目录临时文件、保留原文件权限、同步后替换；返回本次保存内容快照 | [lib.rs](../src-tauri/src/lib.rs) |
| Markdown 文件封装 | 识别并保留 Frontmatter、BOM、LF/CRLF 类型及末尾换行有无；无修改时普通保存不重写文件 | [markdown.ts](../src/lib/markdown.ts)、[App.tsx](../src/App.tsx) |
| 特殊语法保护 | 检出的脚注、数学块、内嵌 HTML、提示块和部分自定义语法、未闭合围栏改为只读原文展示 | [markdown.ts](../src/lib/markdown.ts) |
| 紧凑纸墨外观 | 主题、侧栏显隐；全宽正文；缩小工具区、段落和任务间距；偏好持久化于 localStorage | [global.less](../src/global.less)、[正文样式](../src/components/DocumentEditor/index.module.less)、[settings.ts](../src/store/settings.ts) |
| macOS 合并标题栏 | 原生关闭/最小化/全屏按钮与文件操作同一行，空白处可拖动，显示文件名与未保存状态 | [窗口配置](../src-tauri/tauri.conf.json)、[权限](../src-tauri/capabilities/default.json)、[App.tsx](../src/App.tsx) |
| 基础项目交付 | MIT 文件、源码依赖锁文件、开发说明、示例 Markdown、macOS 本地调试应用包 | [LICENSE](../LICENSE)、[README](../README.md)、[示例](../examples/纸墨试写.md) |

快捷键：⌘/Ctrl + N 新建，⌘/Ctrl + O 打开文件，⌘/Ctrl + Shift + O 打开目录，⌘/Ctrl + S 保存，⌘/Ctrl + Shift + S 另存为，⌘/Ctrl + W 关闭标签，⌘/Ctrl + Shift + W 关闭窗口，⌘/Ctrl + Q 退出。原生菜单命令进入同一工作台操作入口，避免把关闭标签误做关闭窗口。

## 部分实现，不能视为完整功能

| 能力 | 已有基础 | 尚缺部分 |
| --- | --- | --- |
| 文本/代码编辑 | Markdown 中的代码块高亮 | 普通文件编辑、CodeMirror、语言切换、行号、搜索等 |
| 源码模式 | 原文只读弹窗 | 可编辑的 Markdown 源码和与 Tiptap 的模式转换 |
| 文件管理 | 目录树、独立标签、关闭其他标签、目录外文件 | 文件/目录创建、重命名、删除、标签排序、复制路径、在系统文件管理器显示 |
| 链接 | StarterKit 的链接 schema 和输入规则；点击不会直接打开 | 插入/编辑链接弹窗、完整访问交互 |
| 图片 | Image 扩展可承载 Markdown 图片节点 | 本地相对路径解析、粘贴/拖入、附件保存、完整预览 |
| 表格 | 插入 3×3 带表头表格、编辑单元格 | 行列管理和对齐的操作入口；当前未提供列宽调整 |
| 代码块 | 语法高亮、输入围栏创建 | 语言选择 UI、复制按钮 |
| 外部修改 | 写入前快照比较 | 实时监听、未修改时自动重载、对比/合并界面 |
| 跨平台桌面 | Tauri 工程与桌面图标 | Windows/Linux 实际构建验收、对应单行标题栏适配 |
| 第三方许可 | 顶层依赖许可索引 | 分发所需全部传递依赖许可全文与自动核对 |

## 当前限制

- 没有文件/目录管理操作、拖放文件、最近文件、系统文件关联或命令行打开入口。
- 文件树展示非 Markdown 文件但不可打开；符号链接不展开/打开。单级目录超过 10000 项会报错提示使用更小的子目录；没有递归预加载或文件实时监听。
- 目录刷新重置展开状态；关闭/更换目录保留已打开文档。新文件另存到已加载目录后更新对应层；未加载的子目录在展开时读取。
- 没有 `/` 菜单、浮动格式栏、标题折叠、查找替换或独立专注模式。
- 没有自动保存、恢复草稿或上次会话恢复；强制结束进程可能丢失未保存内容。窗口关闭保护不等同于覆盖所有操作系统退出场景。
- 只读取 UTF-8，没有 GB18030 等编码选择；文件大小上限不是 16 MB 文档编辑性能保证。
- 特殊语法检测基于规则，不是完整 Markdown 方言识别；可能保守拦截，也不保证识别所有未知语法。
- 编辑后可能规范化表格、空行等；混合换行会按检测到的类型统一，末尾多空行数量不承诺保留。
- 保存前比较与替换之间没有跨进程文件锁，不能宣称消除了所有并发写入竞态。
- 没有自定义背景、字体/字号/行高设置界面；文档字体颜色等功能按设计排除。
- macOS 原生红黄绿按钮未删除。截图时可能被系统屏幕共享指示条遮挡；原生控件与合并标题栏继续保留。
- 当前有本地 macOS 调试 `.app`，尚无正式签名、公证、Windows/Linux 发布包或公开发布验证。

## 验证记录及范围

以下结果均来自 2026-10-15 本会话的实际工具输出。后续代码变化后应按影响范围重验。

| 验证 | 当时结果 | 实际覆盖 |
| --- | --- | --- |
| `npm test` | 3 个测试文件，34 项通过 | Markdown 封装和结构往返、23 项会话/目录模型测试、7 项真实工作台组件集成测试（原生接口使用替身） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 7 项通过 | 中文文件读写/BOM/CRLF、冲突及删除保护、新文件和无效 UTF-8、目录排序/单层读取、目录越界/旧根、链接循环保护、其他标签另存为保护 |
| `npm run build` | 通过 | TypeScript 和 Vite 生产资源构建；本轮多标签构建通过 |
| `npx tauri build --debug --bundles app` | 通过 | macOS 本地调试 `.app`；目录/多标签版本已打包 |
| 原生窗口人工操作 | 通过 | 目录选择和子目录展开、两个文档独立修改/撤销/保存、磁盘核对、长文滚动恢复、关闭后台脏标签后保存、⌘W 只关标签、⌘Q 取消退出保留草稿、关闭工作目录后保存目录外文件；此前单文档验收也覆盖冲突和另存为 |
| 界面检查 | 已检查 | 紧凑布局、原生合并标题栏、文件树和多标签；此前已检查浅色/深色主题。没有完整小窗口/跨平台矩阵 |

自动测试覆盖状态、交互和磁盘逻辑；原生人工验收补充实际对话框、菜单快捷键和正文滚动。尚未建立自动化原生端到端测试，也不把 macOS 结果扩展为其他平台验收。

[测试源码](../tests/)与 [Rust 测试](../src-tauri/src/lib.rs)是覆盖范围依据。`artifacts/` 中验收文件和截图被 Git 忽略，不作为源码分发必需项；文档目录已保留一张[当前界面截图](images/current-desktop.png)。

## 主要源码入口

```text
src/App.tsx                              工作台与原生命令/关闭提示
src/workspace/model.ts                  多标签会话、目录缓存、保存和关闭队列
src/components/FileTree/                文件树
src/components/DocumentTabs/            标签栏
src/components/DocumentEditor/           编辑器扩展、独立滚动和正文样式
src/lib/files.ts                        Tauri 调用边界
src/lib/markdown.ts                     Markdown 封装与保护
src/store/settings.ts                   外观偏好
src/global.less                         全局布局与主题
src-tauri/src/lib.rs                     原生文件对话框与文件读写
src-tauri/src/workspace.rs               目录选择、单层读取和路径检查
src-tauri/src/menu.rs                    原生菜单和命令事件
src-tauri/tauri.conf.json                桌面窗口和打包
```
