# MinMD · 纸墨

MIT 开源的本地 Markdown 桌面编辑器。使用 Tauri 2、React、Tiptap 和 Paper Ink。

当前实现第一条可用链路：从原生文件对话框打开 UTF-8 Markdown，所见即所得编辑，保存回原文件或另存为。包含标题大纲、格式工具栏、任务列表、表格、代码高亮、阅读模式、只读原文查看、浅色/深色界面、未保存确认和外部修改冲突保护。

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

- 打开文件：⌘/Ctrl + O；新建：⌘/Ctrl + N。
- 保存：⌘/Ctrl + S；另存为：⌘/Ctrl + Shift + S。
- 输入 `# ` 创建标题、`- ` 创建列表、三个反引号加空格创建代码块。
- 在「文档」中直接编辑；「阅读」模式关闭编辑；「原文」只读查看当前 Markdown。
- 可用 `examples/纸墨试写.md` 体验标题、任务列表、引用、表格和代码高亮。

## 文件行为与当前边界

- 当前处理单个 Markdown 文件（UTF-8，16 MB 以内），支持中文文件名与空格路径。
- 没有修改时保存不会重写原文件；编辑后序列化为普通 Markdown，语法写法可能规范化。保留 YAML Frontmatter、UTF-8 BOM 和原有 LF/CRLF 类型。
- 保存前对比打开时的磁盘快照。原文件被其他程序修改或删除时拒绝覆盖，可另存为保留编辑内容。
- 通过同目录临时文件写入并替换原文件，保留文件权限。关闭窗口、新建或打开其他文件时提示未保存修改。
- 检出的脚注、内嵌 HTML、数学块和部分自定义语法暂以原文只读打开。这不是完整 Markdown 方言兼容保证；涉及特殊语法时请先保留副本。
- 相对路径图片预览、本地图片插入、目录树、多标签、代码文件编辑、源码编辑、自定义背景、草稿恢复、系统文件关联将在后续阶段实现。当前图片不具备完整本地资源解析能力。
- 当前尚无崩溃恢复，强制结束进程会丢失未保存修改；不要用未实现的功能替代手动保存。

## 项目结构

- `src/components/DocumentEditor/`：Tiptap 编辑器、Markdown schema、正文排版。
- `src/lib/`：原生调用与 Markdown 文件封装。
- `src/store/`：Zustand 外观设置。
- `src/App.tsx`：单文档工作台、保存与离开交互。
- `src-tauri/src/lib.rs`：原生对话框、UTF-8 读写、文件冲突检测和写入测试。

采用 `@/*` 别名、Less/CSS Modules、Paper Ink 组件及其 Tabler 图标。当前只有一个工作台页面，不预设空路由或 HTTP 层。

## 许可

项目源码按 [MIT](LICENSE) 发布。编辑交互参考 MinMD 文档编辑器；第三方依赖保持各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
