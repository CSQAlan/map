# 路线规划状态一致性 Implementation Plan

> **For agentic workers:** 在当前会话逐项执行并复核；用户已授权自动批准，不派生代理。

**Goal:** 确保路线只对应最新条件，防止异步旧结果误导导航。

**Architecture:** 在现有 createRoutePlanner 内维护递增 requestVersion，通过同步 watch 使四项规划条件变化立即失效。请求只在序号仍相同时写入任何状态，保持现有公开接口。

**Tech Stack:** Vue 3、Node test runner、Vite。

## Task 1: 回归复现
Files: `frontend/tests/route-planner.test.js`
- [x] 添加 deferred fetch 工具，用手工 resolve/reject 精确安排顺序。
- [x] 检查先发后到、旧失败、加载状态、四项条件直接赋值、失败选中路段、空地点和规范化。
- [x] 运行 `node --test tests/route-planner.test.js`，确认新用例在旧实现失败。

## Task 2: 状态修复
Files: `frontend/src/composables/useRoutePlanner.js`
- [x] 导入 watch，集中 resetRoutes 和 invalidatePlanning，注册 flush: 'sync' 的四条件 watcher。
- [x] 新规划先使旧请求失效；校验并规范化后递增版本，再开始 fetch；每个成功、catch、finally 分支都检查版本。
- [x] 空字符串不参与模糊匹配，失败清空 selectedSegmentCode。
- [x] 运行目标测试，再运行 `npm test` 与 `npm run build`。

## Task 3: 文档与提交
Files: `docs/superpowers/plans/2026-10-28-route-consistency.md`, `README.md`
- [x] 文档说明输入变化使路线失效，补充实际验证结果。
- [x] `git diff --check` 并检查暂存文件，只提交本轮文件。
- [x] 提交代码与记录，最终检查 Git 状态和提交编号。


## 验证记录

- 先运行新增回归测试：旧实现出现 9 项断言失败，后续用例因空地点被错误接受而等待未完成请求；调整该用例为先断言请求数，避免悬挂。
- 修复后目标测试共 23 项，包含 18 项新增回归场景。
- `npm test`：44/44 通过，无失败或跳过。
- `npm run build`：Vite 8.1.4 构建成功，100 个模块。首次沙箱限制 Vite 临时目录写入，授权重试通过。
- `git diff --check`：通过。
- 本轮未改后端，未运行后端测试、真机或浏览器端到端测试，未构建 APK。
- 独立代码审查结论：无阻塞问题；审查者复跑路线目标测试 23/23 通过。既有 router 修改及本地原始素材保持原状。
