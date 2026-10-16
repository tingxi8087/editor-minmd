# 开发与桌面打包

更新与验证日期：2026-10-16。

## 准备环境

需要 Node.js 22+、Rust stable 和 [Tauri 平台前置环境](https://v2.tauri.app/start/prerequisites/)。本项目使用 Tauri 2、React、TypeScript、Tiptap、CodeMirror 6 和 Paper Ink。

```sh
git clone https://github.com/tingxi8087/editor-minmd.git
cd editor-minmd
npm ci
npm run dev
```

`npm run dev` 直接启动桌面应用；本地文件读写、系统对话框及文件关联需在桌面窗口验证。浏览器预览仅用于界面调试。

## 命令

| 命令 | 行为 |
| --- | --- |
| `npm run dev` | 同步版本，启动 Tauri 桌面开发；Tauri 自动启动网页开发服务 |
| `npm run build` | 同步版本，构建 release 桌面程序和当前平台分发包，再导出到根目录 `build/` |
| `npm run dev:web` | 仅启动 Vite 浏览器预览，端口 1537 |
| `npm run build:web` | 仅 TypeScript 检查与 Vite 前端构建，输出 `dist/` |
| `npm run desktop` | 保留的 `npm run dev` 别名 |
| `npm run version:sync` | 只同步版本副本与锁文件，不构建 |

Tauri 的 `beforeDevCommand`、`beforeBuildCommand` 分别调用 `dev:web`、`build:web`，不会再调用桌面入口，避免递归启动。

仍可用 `npm run tauri -- …` 调试原始 CLI，但原始 CLI 不执行外层分发导出；日常打包使用 `npm run build`。

## 唯一版本来源

只修改根目录 `package.json.version`，例如从 `0.1.0` 改到 `0.2.0`。支持 SemVer 与预发布版本，不接受路径或非法版本。

- `tauri.conf.json.version` 配置为 `../package.json`，由 Tauri 读取。桌面脚本也将读取到的版本作为 CLI 配置传入，保证使用同一来源。
- 启动、打包与前端钩子执行前，同步 `src-tauri/Cargo.toml` 的本项目版本、`src-tauri/Cargo.lock` 中本项目版本、`package-lock.json` 的根项目版本。依赖版本不改动。
- 相同内容不重复写入，避免启动原生监听后反复触发重建。
- 同步后的文件属于项目元数据，更新版本时应随 `package.json` 一起提交；不要手工分别维护它们。

## 产物目录

本机默认输出示例：

```text
build/
└── 0.1.0/
    └── aarch64-apple-darwin/
        ├── editor-minmd.app
        ├── editor-minmd_0.1.0_aarch64.dmg
        ├── editor-minmd_0.1.0_aarch64-apple-darwin.zip
        └── build-info.json
```

`build-info.json` 记录版本、Rust 目标平台、release/debug、构建时间与文件名。DMG 和 ZIP 可作为分发文件；`.app` 保留在同目录，ZIP 包含完整应用顶层目录。原生应用目录中的相对符号链接与可执行权限在导出时保留。

Rust 编译缓存继续复用 `src-tauri/target/`（也尊重 Cargo 配置的 target 目录）；网页资源在 `dist/`。`build/` 只保存最终分发产物，三者均不提交 Git。

同版本不同平台分开存放；版本变化新建版本目录。重复构建同版本/目标时替换该目标目录，其他版本/目标保留。先构建、导出到临时目录，再替换最终目录；构建或压缩失败保留最后一次成功导出的产物。构建前清理的是当前 Cargo 目标的生成 bundle 缓存，避免将旧安装包混入本次结果。

调试包命令：

```sh
npm run build -- --debug --bundles app
```

导出到 `build/<版本>/<目标>-debug/`，与 release 隔离。可将 `--target <Rust triple>` 等 Tauri 构建参数传入；跨架构/跨平台仍需要对应工具链，不代表在 macOS 上自动生成 Windows/Linux 安装包。`--no-bundle` 不适用于分发入口，只检查网页使用 `build:web`。

## 验证

- `npm test`：11 个文件、160 项通过。新增 6 项脚本测试覆盖版本变化与重复同步、依赖版本不变、非法版本拒绝、分发导出与清单、符号链接/执行权限、失败保留旧产物、不同版本/debug 隔离，以及前端/桌面钩子不递归。
- `npm run dev`：实际执行 `dev:web`，Vite 1537 服务与 `target/debug/editor-minmd` 桌面进程启动；测试后停止开发进程。开发二进制无 `.app` 包，计算机 UI 工具无法按应用包定位它，未将进程检查当作窗口视觉验收。
- `npm run build`：本机 macOS aarch64 release `.app`、DMG、ZIP 和分发清单成功生成并导出。核对导出 `.app` 的两个版本字段与 `package.json` 一致，可执行文件与原构建的 SHA-256 一致。
- ZIP `unzip -t`、DMG `hdiutil verify` 通过。导出的 release `.app` 可独立启动，运行时不依赖 Vite。
- 当前没有 Developer ID 分发签名/Apple 公证；Windows/Linux 分发构建、跨架构与其他 macOS 版本尚未实机验证。Vite 仍有既有主包大小警告。

源码：[桌面入口](../scripts/desktop.mjs)、[版本同步](../scripts/version.mjs)、[分发导出](../scripts/artifacts.mjs)、[测试](../tests/build-scripts.test.ts)。


## 测试与发布

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

桌面应用直接在本机运行，无需部署服务器。`dist/` 的网页构建不包含原生文件能力，不等同于完整桌面应用。

发布前检查版本、测试结果、实际桌面行为、ZIP 完整性与 DMG 校验。将当前源码提交并推送后，以 `v<package.json.version>` 创建 GitHub Release，上传对应平台的 DMG、应用 ZIP、`build-info.json` 与 SHA-256 清单；生成物留在 `build/`，不进入 Git 历史。发布说明需写明支持的平台、架构及签名/公证状态，不将未验证的平台标为可用。

## v0.1.0 发布核验（2026-10-16）

本次发布前重新运行前端 23 个文件 / 325 项测试、Rust 44 项测试，均通过。完整 release 桌面构建通过；导出应用版本为 `0.1.0`、可执行文件为 ARM64，DMG 校验和 ZIP 完整性检查通过。生成 SHA-256 清单随 Release 附件发布。本版仅分发 macOS Apple Silicon，未做 Developer ID 签名与公证。

README 的三张截图来自隔离 macOS 桌面 QA 应用，内容为仓库公开示例 `examples/纸墨试写.md`，分别展示文档、大纲、源码和深色阅读。截图保留系统录屏指示标记。

## 源码导航

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx` | 工作台布局、模式、快捷键与交互入口 |
| `src/components/DocumentEditor/` | Tiptap 文档编辑、Markdown 语法与排版 |
| `src/components/SourceEditor/`、`SourceToolbar/` | CodeMirror 会话、高亮与源码工具栏 |
| `src/components/FileTree/`、`DocumentTabs/` | 文件导航与标签 |
| `src/workspace/model.ts` | 多标签会话、文件操作、关闭队列与目录状态 |
| `src/lib/`、`src/store/` | 原生调用、文件封装与本地设置 |
| `src-tauri/src/` | 原生文件、目录、菜单、系统关联与保存保护 |

项目使用 `@/*` 别名、Less/CSS Modules、Paper Ink 组件及其图标；当前只有一个工作台页面。
