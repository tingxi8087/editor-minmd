# editor-minmd

MIT 开源的本地 Markdown 桌面编辑器。使用 Tauri 2、React、Tiptap、CodeMirror 6 和 Paper Ink。

当前支持打开目录、按需展开文件树和多标签 Markdown、普通文本与代码编辑，也可独立打开目录之外的文件。每个标签独立保留正文、撤销历史、选区、阅读模式和滚动位置。包含格式工具栏、任务列表、表格、代码高亮、标题大纲、阅读和可编辑源码、浅色/深色界面，以及保存冲突和逐标签关闭保护。

## 项目文档

设计方案、已实现能力、当前限制和待实现清单集中在 [doc/](doc/README.md)：

- [设计方案与方案演变](doc/design.md)
- [重启工作区恢复](doc/workspace-session.md)
- [最近文件与目录](doc/recent-items.md)
- [实现现状与验证范围](doc/status.md)
- [源码、文本与代码编辑](doc/source-editing.md)
- [目录文件管理与界面中文化](doc/file-management.md)
- [斜杠插入与 Mermaid 图形](doc/slash-menu.md)
- [自定义背景与侧栏精简](doc/background.md)
- [macOS 默认打开方式](doc/file-associations.md)
- [待实现清单](doc/roadmap.md)

## 开发

需要 Node.js 22+、Rust stable，以及 [Tauri 对应平台前置环境](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run dev       # 启动 Tauri 桌面开发窗口
npm run build     # 构建 release 桌面应用、安装包，并导出到 build/<版本>/<目标平台>/
npm test
```

纯浏览器预览使用 `npm run dev:web`（端口 1537）；仅构建前端使用 `npm run build:web`。`npm run desktop` 保留为桌面开发别名。本地文件操作需要桌面窗口。

版本只修改根目录 `package.json` 的 `version`。启动和构建自动同步 Cargo、npm 锁文件中的本项目版本；Tauri 直接读取该文件。无需分别手改版本号。

当前 macOS Apple Silicon 产物示例：`build/0.1.0/aarch64-apple-darwin/`，含 `editor-minmd.app`、DMG、应用 ZIP 和 `build-info.json`。调试分发包可执行 `npm run build -- --debug --bundles app`，存到对应 `*-debug/` 子目录。`build/` 已忽略，不提交 Git。

当前为本地构建，未做 Developer ID 签名和公证。完整脚本、目录与验证范围见[开发与桌面打包](doc/build.md)。

## 使用

- 文档段落开头输入 `/` 插入标题、列表、表格、图片、表情、日期或本地文档链接，支持关键词过滤与键盘选择。`/mermaid` 插入可编辑源码和本地图形预览，代码块支持语言选择与复制。详见[斜杠与图形说明](doc/slash-menu.md)。

- 打开目录：⌘/Ctrl + Shift + O；打开文件：⌘/Ctrl + O；新建 MD：左侧加号或 ⌘/Ctrl + N（`未命名.md`，所见即所得）；新建文本：左侧文本图标或 ⌘/Ctrl + Shift + N（`未命名`，无后缀，源码编辑）。两类文档分别以空格加编号区分，保存时可自行决定后缀。
- 关闭当前标签：⌘/Ctrl + W；关闭窗口：⌘/Ctrl + Shift + W；退出：⌘/Ctrl + Q。关闭窗口/退出时逐一检查未保存文档。
- 标签切换：Ctrl + Tab / Ctrl + Shift + Tab；标签聚焦后可用左右方向键。
- 文件树按层读取，目录优先排序；根行可新建文件/文件夹，每项“更多操作”或右键菜单可重命名、移到系统回收站；可刷新或关闭目录。关闭/切换目录保留所有已打开标签，重复打开同一路径激活现有标签。
- 保存：⌘/Ctrl + S；另存为：⌘/Ctrl + Shift + S。
- 输入 `# ` 创建标题、`- ` 创建列表、三个反引号加空格创建代码块。
- 在「文档」中直接编辑；「阅读」模式关闭编辑；「源码」通过 CodeMirror 编辑 Markdown。普通文本、代码文件直接使用源码编辑器。
- 左侧齿轮「默认打开方式」可选择文件类型并设为系统默认（macOS）；首次全选，记住勾选，执行后显示逐项结果。
- 左侧底部「背景设置」选择本地 PNG/JPEG/WebP，调节模糊/遮罩并自动保存，可恢复默认；图片复制到本机应用数据目录。左侧只保留文件树/大纲，打开文件通过顶部标签切换。
- 可用 `examples/纸墨试写.md` 体验标题、任务列表、引用、表格和代码高亮。

## 文件行为与当前边界

- 支持 Markdown、普通文本和代码（UTF-8，单文件最多 16 MiB），独立文件对话框与文件树均可打开。二进制 NUL、无效 UTF-8 和符号链接受到保护。
- 源码编辑含行号、语法高亮、语言选择、缩进、括号匹配、折叠、查找替换（⌘/Ctrl F）、自动换行和行列状态。
- 单级目录超过 10000 项会提示打开更小的子目录；未实现目录实时监听，可手动刷新。
- 没有修改时保存不会重写原文件；编辑后序列化为普通 Markdown，语法写法可能规范化。保留 YAML Frontmatter、UTF-8 BOM 和原有 LF/CRLF 类型。
- 保存前对比打开时的磁盘快照。原文件被其他程序修改或删除时拒绝覆盖，可另存为保留编辑内容。
- 通过同目录临时文件写入并替换原文件，保留文件权限。关闭标签、窗口或退出时提示未保存修改。新建、打开和切换标签不会丢弃其他标签的修改；另存为不能覆盖其他已打开标签对应的文件。
- 检出的脚注、内嵌 HTML、数学块和部分自定义语法进入可编辑源码，阻止有损转换到文档模式。切换模式不写盘；无正文修改的切换保留原始文本。跨模式修改后更新目标视图会重建其撤销历史，详见[源码编辑说明](doc/source-editing.md)。
- 本地图片预览、选择/粘贴/拖入图片，复制至文档旁 `assets/`；支持 PNG/JPEG/GIF/WebP，单张最多 20 MB。未保存文档先保存再插图。
- 链接插入/修改/移除（⌘/Ctrl K），阅读时点击、编辑时 ⌘/Ctrl 点击打开网页或本地 Markdown；跨目录另存为会调整相对引用。详见 [图片与链接](doc/resources.md)。
- 未保存正文自动写本地恢复快照，重启后逐份恢复；未编辑文件外部变化自动载入，脏文件提供对比/重新载入/另存副本。详见 [草稿恢复与外部修改](doc/reliability.md)。
- 目录内新建、重命名和回收站删除已实现，有未保存子文件时阻止删除；详见[目录文件管理](doc/file-management.md)。自定义背景已支持，详见[背景与持久化](doc/background.md)。macOS 默认打开方式已支持分组勾选设置，访达打开会交给现有窗口；`.ts` 等非文本类型冲突会跳过并说明，详见[文件关联](doc/file-associations.md)。草稿不替代手动保存；强制退出仍可能丢失最近尚未落盘的输入。

## 项目结构

- `src/components/SourceEditor/`、`SourceToolbar/`：CodeMirror 会话、高亮和紧凑源码工具栏。
- `src/components/DocumentEditor/`：Tiptap 编辑器、Markdown schema、正文排版。
- `src/lib/`：原生调用与 Markdown 文件封装。
- `src/store/`：Zustand 外观设置。
- `src/App.tsx`：紧凑工作台、模式、快捷键及离开交互。
- `src/workspace/model.ts`：多标签独立编辑会话、文件操作、关闭队列及异步目录状态。
- `src/components/FileTree/`、`src/components/DocumentTabs/`：文件树和标签栏。
- `src-tauri/src/lib.rs`：原生文件对话框、UTF-8 读写、文件冲突保护。
- `src-tauri/src/workspace.rs`：目录选择、单层读取及路径边界。
- `src-tauri/src/menu.rs`：原生菜单与标签/窗口快捷键。

采用 `@/*` 别名、Less/CSS Modules、Paper Ink 组件及其 Tabler 图标。当前只有一个工作台页面，不预设空路由或 HTTP 层。

## 许可

项目源码按 [MIT](LICENSE) 发布。编辑交互参考 minmd 文档编辑器；第三方依赖保持各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

代码块语言搜索、删除与表格行列/对齐/列宽操作见[交互说明](doc/block-interactions.md)。

侧栏：⌘/Ctrl + B 收起/展开文件与大纲；该快捷键优先用于侧栏，粗体可用格式工具栏。

文档和阅读查找：⌘/Ctrl + F；阅读仅查找，文档可展开替换。⌘/Ctrl + 1 / 2 / 3 切换文档 / 阅读 / 源码；设置中「快捷键」页签可查看现有键位。详见[文档查找与快捷键](doc/document-search.md)。
