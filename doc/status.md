# 实现现状

核对日期：2026-10-16。依据当前源码、项目配置、本轮自动测试和 macOS 桌面验收。

## 当前可用链路

在 Tauri 桌面窗口通过原生文件对话框或文件树打开 UTF-8 Markdown、文本和代码。Markdown 可直接编辑排版后的正文，也可切换 CodeMirror 源码；普通文件直接源码编辑，统一手动保存或另存为。文件树内支持新建、重命名和系统回收站删除。当前支持目录工作台、按层文件树和多标签；打开目录或新文件不会丢弃其他标签的修改。

## 已实现

| 范围 | 当前行为 | 源码入口 |
| --- | --- | --- |
| 新建、打开、保存 | 左侧加号或菜单「新建 MD」创建 `未命名.md`，左侧 MD 加号下方的文本图标创建无后缀 `未命名`；分别编号并保留保存建议名；原生打开/保存对话框；保存回原文件、另存为；取消对话框不执行写入 | [App.tsx](../src/App.tsx)、[files.ts](../src/lib/files.ts)、[lib.rs](../src-tauri/src/lib.rs) |
| 目录与文件树 | 原生目录选择、按层展开、目录优先排序、空目录提示、读取错误重试、手动刷新与关闭目录；越界路径被拒绝 | [workspace.rs](../src-tauri/src/workspace.rs)、[FileTree](../src/components/FileTree/index.tsx) |
| 目录文件管理 | 根行和右键/更多菜单新建文件/文件夹、重命名与系统回收站；同步打开路径/草稿/监听，脏子文件阻止删除；中文查找替换 | [目录管理说明](file-management.md) |
| 多标签 | 每份文件独立 Editor、正文、修改标记、选区、滚动位置、阅读模式与撤销历史；按规范化路径去重，重复打开激活已有标签 | [model.ts](../src/workspace/model.ts)、[DocumentTabs](../src/components/DocumentTabs/index.tsx) |
| 文件读取 | 对话框允许所有文件；限制普通 UTF-8 文本为 16 MiB，拒绝 NUL/无效编码；处理中文名与空格路径 | [lib.rs](../src-tauri/src/lib.rs) |
| 斜杠与图形 | 20 项 `/` 菜单、关键词/键盘/输入法、表情/日期/本地引用；Mermaid 本地图形与错误保护，代码块语言选择/复制 | [交互与验收](slash-menu.md) |
| 代码块与表格交互 | 空内容提示修复、语言搜索/自定义/删除、Mermaid 视图；表格增删行列/整列对齐/删除范围预览/列宽拖动 | [交互说明](block-interactions.md) |
| 所见即所得 | Tiptap 文档编辑，正文、H1—H6、粗斜体、删除线、列表、任务、引用、代码块、基础表格 | [extensions.ts](../src/components/DocumentEditor/extensions.ts)、[App.tsx](../src/App.tsx) |
| 图片与链接 | 本地/远程图片显示、选图/粘贴/原生拖放接入、assets 独立保存、链接弹窗及本地跳转；另存为按结构改写相对引用，保留会话撤销 | [资源说明](resources.md)、[resources.rs](../src-tauri/src/resources.rs) |
| 格式工具栏 | 段落格式、撤销重做、粗斜体、删除线、三类列表、引用、代码块、插入表格 | [App.tsx](../src/App.tsx) |
| 代码高亮 | 文档内代码块使用 Lowlight / Highlight.js 常用语言集合 | [extensions.ts](../src/components/DocumentEditor/extensions.ts) |
| 文档导航 | 侧栏切换文件/标题大纲；点击标题定位；切换标签恢复各自滚动位置 | [App.tsx](../src/App.tsx) |
| 阅读与源码 | 阅读模式关闭编辑；CodeMirror 6 编辑 Markdown 源码，模式切换不写盘；普通文本/代码直接源码编辑 | [App.tsx](../src/App.tsx) |
| 修改与离开保护 | 修改标记；关闭单个/其他标签、关闭窗口和菜单退出时逐份确认；可取消或保存后继续，新建/打开/切换不会替换未保存内容 | [App.tsx](../src/App.tsx) |
| 编辑会话隔离 | 每个标签保留独立编辑器实例及撤销历史，关闭时销毁并释放原生文件登记；阅读状态变化不触发正文更新 | [model.ts](../src/workspace/model.ts) |
| 草稿恢复 | 防抖/最大等待、本机原子恢复库、富文本 JSON 或源码字面快照；逐份恢复/丢弃、重名副本、冲突识别、写入失败提示与重试 | [可靠性说明](reliability.md)、[reliability.rs](../src-tauri/src/reliability.rs) |
| 外部正文监听 | 父目录系统监听、焦点与 15 秒补查；干净自动载入、脏标签保护、并排对比/重载确认、删除和读取失败保留正文 | [model.ts](../src/workspace/model.ts)、[ReliabilityPanel](../src/components/ReliabilityPanel/index.tsx) |
| 保存冲突 | 保存时对比原始快照，文件被外部改动或删除时拒绝覆盖；另存为目标若属于其他已打开标签则拒绝写入 | [lib.rs](../src-tauri/src/lib.rs) |
| 文件写入 | 同目录临时文件、保留原文件权限、同步后替换；返回本次保存内容快照 | [lib.rs](../src-tauri/src/lib.rs) |
| Markdown 文件封装 | 识别并保留 Frontmatter、BOM、LF/CRLF 类型及末尾换行有无；无修改时普通保存不重写文件 | [markdown.ts](../src/lib/markdown.ts)、[App.tsx](../src/App.tsx) |
| 特殊语法保护 | 检出的脚注、数学块、内嵌 HTML、提示块和部分自定义语法、未闭合围栏转可编辑源码，阻止有损转换 | [markdown.ts](../src/lib/markdown.ts) |
| macOS 默认打开方式 | 分组/扩展名勾选、全选/半选、记住选择、逐项写入与回读；非文本冲突跳过；访达启动/运行中打开进入同一工作台，保留已打开脏内容 | [关联设置与验收](file-associations.md) |
| 自定义背景 | 本地 PNG/JPEG/WebP 副本、模糊/遮罩即时预览、原生清单持久化、重启恢复、恢复默认与旧图清理；固定正文纸面保护 | [背景说明](background.md)、[background.rs](../src-tauri/src/background.rs) |
| 紧凑纸墨外观 | 主题、侧栏显隐；全宽正文；缩小工具区、段落和任务间距；主题/侧栏偏好持久化于 localStorage；左侧移除「已打开」列表，使用顶部标签 | [global.less](../src/global.less)、[正文样式](../src/components/DocumentEditor/index.module.less)、[settings.ts](../src/store/settings.ts) |
| macOS 合并标题栏 | 原生关闭/最小化/全屏按钮与文件操作同一行；顶部按打开文件、打开目录排序，保存通过快捷键/菜单；空白处可拖动，显示文件名与未保存状态 | [窗口配置](../src-tauri/tauri.conf.json)、[权限](../src-tauri/capabilities/default.json)、[App.tsx](../src/App.tsx) |
| 基础项目交付 | MIT 文件、源码依赖锁文件、开发说明、示例 Markdown、macOS 本地调试应用包 | [LICENSE](../LICENSE)、[README](../README.md)、[示例](../examples/纸墨试写.md) |

源码支持扩展名识别、手动语言切换、行号/行列、语法高亮、括号匹配、Tab 缩进、折叠、查找替换、自动换行。详见[源码编辑说明](source-editing.md)。

快捷键：⌘/Ctrl + N 新建 Markdown，⌘/Ctrl + Shift + N 新建文本，⌘/Ctrl + O 打开文件，⌘/Ctrl + Shift + O 打开目录，⌘/Ctrl + S 保存，⌘/Ctrl + Shift + S 另存为，⌘/Ctrl + W 关闭标签，⌘/Ctrl + Shift + W 关闭窗口，⌘/Ctrl + Q 退出。原生菜单命令进入同一工作台操作入口，避免把关闭标签误做关闭窗口。

## 部分实现，不能视为完整功能

| 能力 | 已有基础 | 尚缺部分 |
| --- | --- | --- |
| 源码/代码扩展 | CodeMirror、语法高亮、行号、语言切换、查找替换 | 跳转行、目录搜索、编码选择、大文件实测；不含 LSP/调试器 |
| 文件管理 | 目录树、独立标签、关闭其他标签、目录外文件 | 跨目录移动、多选、标签排序、复制路径、在系统文件管理器显示 |
| 链接扩展 | 插入/修改/移除、网页/本地 Markdown/标题锚点访问已提供 | 非 Markdown 本地文件、其他方言锚点 |
| 图片扩展 | 相对路径预览、选图/粘贴/拖入、assets 保存、缺失占位 | 替换与替代文字入口、尺寸调整、SVG、附件清理；Finder 实际拖放人工验收 |
| 表格扩展 | 行列管理、整列对齐、临时列宽与横向滚动 | 不提供合并单元格等普通 Markdown 无法稳定表达的布局；像素列宽不写入 Markdown |
| 外部修改扩展 | 已打开文件监听、干净自动载入、脏文件并排对比与重载确认 | 文件树/附件监听、逐行差异、三方合并、目录迁移跟随 |
| 跨平台桌面 | Tauri 工程与桌面图标 | Windows/Linux 实际构建验收、对应单行标题栏适配 |
| 第三方许可 | 顶层依赖许可索引 | 分发所需全部传递依赖许可全文与自动核对 |

## 当前限制

- 没有跨目录移动、多选、拖放打开文档/目录、最近文件或命令行打开入口；macOS 文件关联与访达打开已支持，Windows/Linux 尚未实现。
- 文件树可打开普通文本和代码；符号链接不展开/打开。单级目录超过 10000 项会报错提示使用更小的子目录；没有递归预加载或文件树实时刷新；已打开正文文件有独立实时监听。
- 目录刷新重置展开状态；关闭/更换目录保留已打开文档。新文件另存到已加载目录后更新对应层；未加载的子目录在展开时读取。
- 没有浮动格式栏、文档标题折叠或独立专注模式；查找替换目前仅源码模式提供。
- 原 Markdown 仍手动保存；未保存正文已有本地恢复快照，但强制结束可能丢失最近尚未落盘输入。不恢复已保存标签、目录或撤销历史；系统注销/关机和断电未验收。恢复库损坏时保留原文件并提示，暂停新恢复写入。
- 只读取 UTF-8，没有 GB18030 等编码选择；文件大小上限不是 16 MB 文档编辑性能保证。
- 特殊语法检测基于规则，不是完整 Markdown 方言识别；可能保守拦截，也不保证识别所有未知语法。
- 所见即所得实际编辑后可能规范化表格、空行等；源码保留 BOM、空白和末尾多空行，修改后混合换行统一为检测到的类型。跨模式实际改动会重建目标模式的撤销历史，不提供跨模式逐步撤销。
- 保存前比较与替换之间没有跨进程文件锁，不能宣称消除了所有并发写入竞态。
- 背景已支持本地选图、模糊/遮罩和恢复默认；尚无位置/正文透明度、字体/字号/行高设置界面；文档字体颜色等功能按设计排除。
- macOS 原生红黄绿按钮未删除。截图时可能被系统屏幕共享指示条遮挡；原生控件与合并标题栏继续保留。
- 当前有本地 macOS 调试 `.app`，尚无正式签名、公证、Windows/Linux 发布包或公开发布验证。

## 验证记录及范围

以下结果均来自 2026-10-15 本会话的实际工具输出。后续代码变化后应按影响范围重验。

| 验证 | 当时结果 | 实际覆盖 |
| --- | --- | --- |
| `npm test` | 17 个测试文件，246 项通过 | Markdown 封装和结构往返、33 项会话/目录/资源模型测试、26 项可靠性模型测试、30 项真实工作台组件集成测试、4 项资源路径测试；29 项源码/多语言/模式/恢复/保存测试、10 项目录变更模型测试、11 项背景模型测试；新增 7 项默认打开方式、5 项外部文件队列测试、6 项版本同步/打包导出测试；30 项斜杠菜单、12 项插入对话框、15 项代码块/Mermaid、19 项表格、4 项空内容/块边界测试（原生接口使用替身） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 31 项通过 | 中文文件读写/BOM/CRLF、冲突及删除保护、新文件和无效 UTF-8、目录排序/单层读取、目录越界/旧根、链接循环保护、其他标签另存为保护；图片校验、复制、路径改写及资源目录符号链接保护；恢复库往返/结构/损坏/失败保护、真实系统监听的原子替换/删除/重建 |
| `npm run build` | 通过 | 当前为桌面 release 打包入口；本机生成 `.app`、DMG 和 ZIP，导出到 `build/0.1.0/aarch64-apple-darwin/`，版本核对、ZIP 完整性及 DMG 校验通过，见[打包说明](build.md) |
| `npx tauri build --debug --bundles app` | 通过 | macOS 本地调试 `.app`；背景/侧栏精简版本已打包 |
| 原生窗口人工操作 | 通过 | 目录选择和子目录展开、两个文档独立修改/撤销/保存、磁盘核对、长文滚动恢复、关闭后台脏标签后保存、⌘W 只关标签、⌘Q 取消退出保留草稿、关闭工作目录后保存目录外文件；此前单文档验收也覆盖冲突和另存为。本轮补充图片显示、原生选图、预览复制图片后粘贴、相对链接跳转、跨目录另存为和整套目录迁移后重开，已核对磁盘；本轮还验证原子替换自动刷新、脏文件对比/取消重载、删除/重建保留内容、两份草稿 SIGKILL 后恢复、恢复冲突、明确放弃后记录清理；此前构建含任务/表格的 JSON 快照 SIGKILL 恢复前后结构一致；本轮新增 CodeMirror 高亮/行号、原生文本新建/保存、撤销/重做/查找、源码与文档同步、特殊语法保护、二进制拒绝、长代码滚动、代码外部修改/冲突，以及 TS/脚注源码 SIGKILL 恢复和另存副本，均核对磁盘内容，详见[源码编辑验证](source-editing.md)。本轮目录管理实测覆盖新建子文件/文件夹、脏代码随父目录改名、保存新路径、文件改名、中文查找替换、重名保护、回收站删除及访达放回原处；详情见[目录管理验证](file-management.md)。本轮补充原生选背景、滑块、浅深色零遮罩、取消/坏图保护、移走原图后重启、受管副本缺失回退/重试与恢复默认清理，见[背景验证](background.md) |
| 界面检查 | 已检查 | 紧凑布局、原生合并标题栏、文件树和多标签；此前已检查浅色/深色主题。本轮检查目录菜单、中文查找栏、背景设置与移除左侧重复导航；没有完整小窗口/跨平台矩阵 |

自动测试覆盖状态、交互和磁盘逻辑；原生人工验收补充实际对话框、菜单快捷键和正文滚动。尚未建立自动化原生端到端测试，也不把 macOS 结果扩展为其他平台验收。

[测试源码](../tests/)与 [Rust 测试](../src-tauri/src/lib.rs)是覆盖范围依据。`artifacts/` 中验收文件和截图被 Git 忽略，不作为源码分发必需项；文档目录已保留[当前背景界面截图](images/background-light.jpg)。

## 主要源码入口

```text
src/App.tsx                              工作台与原生命令/关闭提示
src/workspace/model.ts                  多标签会话、目录缓存、保存和关闭队列
src/components/FileTree/                文件树
src/components/DocumentTabs/            标签栏
src/components/DocumentEditor/           编辑器扩展、独立滚动和正文样式
src/components/SourceEditor/             CodeMirror 状态、语言和独立视图
src/components/BackgroundSettings/       紧凑背景设置浮层
src/lib/background.ts                   背景状态与参数写入队列
src-tauri/src/background.rs             图片副本、清单、解码校验和清理
src/components/SourceToolbar/            语言、查找和换行工具栏
src/lib/sourceResources.ts               源码 URL 区间改写
src/components/ResourceTools/           图片/链接按钮与链接弹窗
src/components/ReliabilityPanel/        恢复列表与磁盘冲突交互
src/lib/reliability.ts                  草稿/监听 Tauri 边界
src/lib/resources.ts                    文档资源 URL 换算
src/lib/files.ts                        Tauri 调用边界
src/lib/markdown.ts                     Markdown 封装与保护
src/store/settings.ts                   外观偏好
src/global.less                         全局布局与主题
src-tauri/src/lib.rs                     原生文件对话框与文件读写
src-tauri/src/workspace.rs               目录选择、单层读取和路径检查
src-tauri/src/resources.rs               图片读写、资源改写和链接访问
src-tauri/src/reliability.rs             恢复库、磁盘快照与系统监听
src-tauri/src/menu.rs                    原生菜单和命令事件
src-tauri/tauri.conf.json                桌面窗口和打包
```

2026-10-16：macOS 默认打开方式设置与访达接收已完成本机验证，构建已更新；完整范围与未验收项见[文件关联](file-associations.md)。

2026-10-16：`npm run dev` 已改为桌面开发，网页独立为 `dev:web` / `build:web`。版本统一来自 `package.json`，分发包按版本/平台导出到 `build/`。开发入口实际启动 Vite 与 Tauri 进程，测试后已停止；桌面分发包单独验收。

2026-10-16：20 项斜杠菜单、表情/日期/本地引用、代码块语言与复制、Mermaid 本地图形渲染已实现。前端 216 项与 Rust 31 项通过，真实浏览器及隔离 macOS 桌面验收见[斜杠与图形](slash-menu.md)。表格行列管理与对齐随后已补齐，见[交互说明](block-interactions.md)。

2026-10-16：空代码块占位重叠修复，代码语言搜索/自定义/删除、Mermaid 图表/源码切换，表格行列管理/对齐/列宽已补齐；本轮前端全量 246 项通过。详细交互与验证见[代码块与表格](block-interactions.md)。

2026-10-16：精简顶部操作，仅保留「打开文件」「打开目录」并按此排序；「新建文本」移至左侧 MD 加号下方图标，移除顶部保存按钮、左下墨字和状态栏左侧文案。保存快捷键、原生菜单、标签修改标记与草稿状态保留。
