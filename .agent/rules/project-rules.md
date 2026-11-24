# Project Rules: CuteDock (Go + Wails v3 Windows 便携应用与脚本管理工具)

## 1. 核心架构与 Go 工程规范
- **零 CGO 纯 Go 原则（优先遵守）**：
  - 数据库驱动必须使用纯 Go 的 `modernc.org/sqlite`，禁止引入强依赖 CGO/GCC 的 `mattn/go-sqlite3`，确保 Windows 环境下编译快速且无额外 C 工具链依赖。
- **绝对绿色免安装 (Strict Portable Mode)**：
  - 所有运行时数据必须存储在可执行文件同级目录的 `./data/` 下（`./data/app.db`、`./data/icons/`、`./data/scripts/`）。开发模式（`wails3 dev`）下使用项目根目录的 `./dev_data/`。
  - 禁止向 `%APPDATA%`、`%LOCALAPPDATA%` 或注册表写入业务数据（除非用户主动开启“开机自启”）。
- **清晰的可扩展分层架构**：
  - Go 后端遵循标准目录布局：
    - `internal/db/`：SQLite 初始化、连接管理、版本化 Schema Migration（禁止破坏旧数据）。
    - `internal/model/`：数据实体与 DTO 定义。
    - `internal/service/`：暴露给 Wails v3 前端的独立 Service（`AppService`、`ScriptService`、`ScheduleService`、`LogService`、`SettingsService`），方便后续直接注册新功能模块。
    - `internal/runner/`：跨类型脚本执行引擎、实时输出捕获与超时控制。
    - `internal/scheduler/`：基于 `robfig/cron/v3` 的后台定时调度器。
    - `internal/winapi/`：Windows 专属封装（`.lnk` 解析、图标提取转 PNG、无黑框执行、管理员运行、全局热键）。
  - 前端（React + TypeScript）按业务域划分：`src/features/apps`、`src/features/scripts`、`src/features/logs`、`src/features/settings`、`src/components/ui`。

## 2. UI/UX 风格规范（清爽可爱风）
- 整体视觉：清爽、软萌、轻盈、现代（类似 Maye Lite 的高效启动体验 + 日系马卡龙/奶油配色）。
- 视觉细节：
  - 柔和浅色背景（如 `#FAF9F6` 奶油白 / `#F4F8FB` 云朵白），卡片大圆角 `rounded-2xl`，按钮与输入框 `rounded-xl`。
  - 低饱和度马卡龙强调色（薄荷绿、樱花粉、天空蓝、奶油黄），通过 CSS 变量支持一键切换主题。
  - 柔和微动效（hover 轻上浮、弹窗平滑过渡），默认简体中文，文案简短亲和。

## 3. Windows 专项防坑规范
- 执行外部脚本默认设置 `SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}`（`CREATE_NO_WINDOW`），不弹出黑色控制台窗口；仅在用户勾选“显示终端运行”时弹窗。
- 捕获脚本 `stdout`/`stderr` 时，必须实现 UTF-8 有效性检测并在非 UTF-8 时使用 `golang.org/x/text/encoding/simplifiedchinese`（GB18030）自动转码，防止中文输出乱码。
- 所有耗时操作（脚本执行、图标提取、批量任务）必须通过 Goroutine 异步执行，并使用 Wails v3 Event 机制推送状态变更给前端，绝不阻塞主线程。