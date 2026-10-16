# macOS 默认打开方式

实现与验证日期：2026-10-16。

## 使用

左侧底部齿轮打开「默认打开方式」，也可从 MinMD 原生菜单打开（⌘,）。首次全选 32 个扩展名，分为 Markdown、普通文本、配置与数据、代码文件；各组可展开逐个选择，支持全选、取消全选和半选显示。勾选项保存在本机，重新打开应用仍保留，包括全部取消的状态。

点击「设为默认打开应用」才执行系统默认关联修改。设置期间锁定选择、弹窗关闭和工作台退出；完成后逐扩展名显示成功或失败。关闭、切换勾选不会撤销旧关联，不提供自动恢复旧默认应用。

必须使用构建后的 `MinMD.app`，建议先放到「应用程序」再设置。直接运行开发二进制会提示使用 `.app`。应用移动位置后如系统仍指向旧位置，可在新位置重新执行设置。

## 原生实现

- `tauri.macos.conf.json` 仅为 macOS `.app` 声明 31 种文本扩展名的 Editor 能力，使用 Alternate 排名。每类单独声明内容类型；未注册的文本类型导出独立 UTI，Markdown/YAML 提供导入声明。安装、启动可能让系统为原本没有默认应用的类型选择 MinMD；应用不会在启动时主动批量写入默认偏好。
- 原生命令先校验扩展名白名单，调用 `LSRegisterURL` 更新当前应用登记。根据扩展名解析 UTI，只为符合 `public.text` 的类型请求默认处理应用；随后读取系统默认处理者。只有系统写入返回成功、读取结果确为本应用时才显示成功，否则说明错误码或访达手动设置路径。
- macOS 按 UTI 设置，`.md` / `.markdown`、`.txt` / `.text`、`.yaml` / `.yml` 等可能共享一项系统关联。取消同类型中的一个扩展名不代表能隔离另一个扩展名的影响，界面明确提示。
- **`.ts` 有歧义**：本机系统解析为 `public.mpeg-2-transport-stream`（视频）。保留可选项以显示明确的逐项结果，但不注册视频类型、不会改变视频播放器；若系统判为非文本就跳过并提示使用访达「打开方式」。MinMD 自身打开/编辑 TypeScript 不受影响。
- Launch Services 的这些接口已被 Apple 标为 deprecated；本实现为 macOS 桌面兼容路径，实际结果以系统回读为准，不假设所有系统版本都允许静默修改。Windows/Linux 显示当前仅支持 macOS，未实现默认关联修改与对应外部启动参数。

参考：[Apple Launch Services](https://developer.apple.com/documentation/coreservices/1448020-lscopyallrolehandlersforcontentt)、[应用登记](https://developer.apple.com/documentation/coreservices/1446350-lsregisterurl)、[Tauri 文件类型声明](https://v2.tauri.app/reference/config/#fileassociation)、[Tauri 文件打开事件示例](https://github.com/tauri-apps/tauri/blob/dev/examples/file-associations/src-tauri/src/main.rs)。

## 外部文件接收

macOS 的 `RunEvent::Opened` 接收 file URL 并在 Rust 端排队。前端先订阅通知，再读取启动前已到达的请求，避免网页尚未就绪时丢失文件。保存或关闭确认期间等待工作台空闲；读取途中发生新操作时也缓存结果。

原生只读取系统交付队列中的文件，沿用 16 MiB、UTF-8、NUL/普通文件校验和已打开路径登记。路径规范化后交给原有会话入口：同一文件切换到已有标签，保留脏内容；新文件按类型进入 Markdown 文档或源码模式。批量中某文件失败不阻止其他文件，失败显示到工作台。

这是系统打开事件接收，不等于将文档拖入编辑区域打开，也没有新增命令行参数解析。现有正文区域拖放仍用于插图。

## 自测与边界

- 前端自动测试：154 项通过，包含 7 项关联设置测试、5 项外部文件接收测试。覆盖初始全选、分组/单项/空选、半选、持久化、等待期间锁定、逐项失败、原生异常、非 macOS 禁用、前后端/打包声明一致；启动队列、后续事件、忙碌/关闭等待、异步结果缓存、部分文件失败和订阅清理。
- Rust：30 项通过，新增白名单验证和本机全部扩展名的真实系统 UTI 解析/默认处理者只读核对；原有 28 项文件、草稿、资源、背景测试继续通过。
- macOS 真窗口：默认全选、展开/半选、全部取消、重新启动后选择保留；只选择 `.ts` 执行设置，确认非文本保护与失败反馈；对读取时已由 MinMD 处理的 `.toml` 验证原生写入及回读成功，再在访达双击 TOML，确认进入 MinMD 并显示 TOML 高亮。没有批量覆盖用户既有 Markdown/文本等默认应用，结束时勾选恢复全选。
- 访达「打开方式 → MinMD」验证 Markdown 冷启动和运行中打开、普通文本源码编辑；再次打开已经修改的文本，确认没有多建标签且未保存内容仍保留。验收修改已通过「不保存」清理，原始验收文件未改写。
- 浅色/深色紧凑弹窗均已检查，结束后恢复浅色；`.app` 构建与 Info.plist 核对：31 类文档能力、11 类自有文本 UTI、2 类导入类型。Vite 仍有既有主包体积警告。
- 未完整验收不同 macOS 版本、系统确认提示/拒绝、多个同标识 `.app` 并存以及所有扩展名的双击行为；逐项系统失败不能视为整体成功。

源码：[原生关联与队列](../src-tauri/src/associations.rs)、[设置界面](../src/components/Settings/index.tsx)、[前端外部文件接收](../src/lib/externalFiles.ts)、[界面测试](../tests/associations.test.tsx)、[接收测试](../tests/external-files.test.ts)。

设置入口现为左侧齿轮「设置」，默认进入「默认打开方式」页签；另有「关于」展示应用版本、项目简介与 MIT 许可。切换页签不会更改系统关联，也不会丢失已勾选项。
