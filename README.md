# MinMD · 纸墨

MIT 开源的本地 Markdown 桌面编辑器。使用 Tauri 2、React、Tiptap 和 Paper Ink。

当前支持打开目录、按需展开文件树和多标签 Markdown 编辑，也可独立打开目录之外的文件。每个标签独立保留正文、撤销历史、选区、阅读模式和滚动位置。包含格式工具栏、任务列表、表格、代码高亮、标题大纲、阅读和只读原文、浅色/深色界面，以及保存冲突和逐标签关闭保护。

## 项目文档

设计方案、已实现能力、当前限制和待实现清单集中在 [doc/](doc/README.md)：

- [设计方案与方案演变](doc/design.md)
- [实现现状与验证范围](doc/status.md)
- [待实现清单](doc/roadmap.md)

## 开发

需要 Node.js 22+、Rust stable，以及 [Tauri 对应平台前置环境](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run desktop
```

`npm run dev` 仅启动浏览器界面预览（端口 1537），本地文件打开和保存需要 Tauri 桌面窗口。

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

macOS 本地调试应用包：`npm run tauri -- build --debug --bundles app`，产物位于 `src-tauri/target/debug/bundle/macos/MinMD.app`。该应用包是本地开发构建，尚未签名、公证。

## 使用

- 打开目录：⌘/Ctrl + Shift + O；打开文件：⌘/Ctrl + O；新建：⌘/Ctrl + N。
- 关闭当前标签：⌘/Ctrl + W；关闭窗口：⌘/Ctrl + Shift + W；退出：⌘/Ctrl + Q。关闭窗口/退出时逐一检查未保存文档。
- 标签切换：Ctrl + Tab / Ctrl + Shift + Tab；标签聚焦后可用左右方向键。
- 文件树按层读取，目录优先排序；可刷新或关闭目录。关闭/切换目录保留所有已打开标签，重复打开同一路径激活现有标签。
- 保存：⌘/Ctrl + S；另存为：⌘/Ctrl + Shift + S。
- 输入 `# ` 创建标题、`- ` 创建列表、三个反引号加空格创建代码块。
- 在「文档」中直接编辑；「阅读」模式关闭编辑；「原文」只读查看当前 Markdown。
- 可用 `examples/纸墨试写.md` 体验标题、任务列表、引用、表格和代码高亮。

## 文件行为与当前边界

- 当前编辑 Markdown（UTF-8，单文件读取前限制 16 MB 以内），支持中文文件名和空格路径。文件树展示其他类型但暂不可打开；符号链接不展开，避免目录循环和越界。
- 单级目录超过 10000 项会提示打开更小的子目录；未实现目录实时监听，可手动刷新。
- 没有修改时保存不会重写原文件；编辑后序列化为普通 Markdown，语法写法可能规范化。保留 YAML Frontmatter、UTF-8 BOM 和原有 LF/CRLF 类型。
- 保存前对比打开时的磁盘快照。原文件被其他程序修改或删除时拒绝覆盖，可另存为保留编辑内容。
- 通过同目录临时文件写入并替换原文件，保留文件权限。关闭标签、窗口或退出时提示未保存修改。新建、打开和切换标签不会丢弃其他标签的修改；另存为不能覆盖其他已打开标签对应的文件。
- 检出的脚注、内嵌 HTML、数学块和部分自定义语法暂以原文只读打开。这不是完整 Markdown 方言兼容保证；涉及特殊语法时请先保留副本。
- 相对路径图片预览、本地图片插入、目录文件增删/重命名、代码文件编辑、源码编辑、自定义背景、草稿恢复、系统文件关联将在后续阶段实现。当前图片不具备完整本地资源解析能力。
- 当前尚无崩溃恢复，强制结束进程会丢失未保存修改；不要用未实现的功能替代手动保存。

## 项目结构

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

项目源码按 [MIT](LICENSE) 发布。编辑交互参考 MinMD 文档编辑器；第三方依赖保持各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
