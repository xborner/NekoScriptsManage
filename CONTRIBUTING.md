# 贡献指南（Contributing）

感谢你对 **NekoScriptsManage** 的关注！欢迎提交 Issue、功能建议或 Pull Request。

## 🤖 AI 辅助开发说明

本项目采用 **人机协作（AI-Assisted Development）** 模式完成：
- **AI 协作伙伴**：**北美大豆包**（参与架构规划、Go + Wails v3 后端实现、React + TypeScript 前端界面、单元测试与文档撰写）
- **项目维护者**：[@xborner](https://github.com/xborner)（负责需求定义、视觉素材挑选、实机测试与最终验收）

我们也欢迎社区贡献者使用 AI 工具辅助编写代码，只需确保提交前已完成本地构建与测试验证。

## 📌 提交 Pull Request 建议

1. 遵循零 CGO 纯 Go 与严格便携模式（`./data/`）架构原则（详见 `.agent/rules/project-rules.md`）。
2. 提交前请确认以下检查通过：
   ```powershell
   go test -v ./internal/...
   cd frontend && npm run build
   ```
3. Commit 信息建议使用清晰简洁的中文（如 `feat: ...`、`fix: ...`、`docs: ...`）；若由 AI 辅助完成，可在提交说明末尾添加协作尾注（避免使用他人已注册的 `@users.noreply.github.com` 邮箱）：
   ```text
   Co-authored-by: 北美大豆包 <beimeidadoubao@neko.local>
   ```

## 🎨 素材与版权提醒

请勿在 PR 中提交未经授权的商业图片或可执行二进制产物（`bin/`、`dev_data/`、`data/` 已在 `.gitignore` 中排除）。
