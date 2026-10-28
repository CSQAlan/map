# 路线规划状态一致性 Implementation Plan

> **For agentic workers:** 在当前会话逐项执行并复核；用户已授权自动批准，不派生代理。

**Goal:** 确保路线只对应最新条件，防止异步旧结果误导导航。

**Architecture:** 在现有 createRoutePlanner 内维护递增 requestVersion，通过同步 watch 使四项规划条件变化立即失效。请求只在序号仍相同时写入任何状态，保持现有公开接口。

**Tech Stack:** Vue 3、Node test runner、Vite。

## Task 1: 回归复现
Files: `frontend/tests/route-planner.test.js`
- [ ] 添加 deferred fetch 工具，用手工 resolve/reject 精确安排顺序。
- [ ] 检查先发后到、旧失败、加载状态、四项条件直接赋值、失败选中路段、空地点和规范化。
- [ ] 运行 `node --test tests/route-planner.test.js`，确认新用例在旧实现失败。

## Task 2: 状态修复
Files: `frontend/src/composables/useRoutePlanner.js`
- [ ] 导入 watch，集中 resetRoutes 和 invalidatePlanning，注册 flush: 'sync' 的四条件 watcher。
- [ ] 新规划先使旧请求失效；校验并规范化后递增版本，再开始 fetch；每个成功、catch、finally 分支都检查版本。
- [ ] 空字符串不参与模糊匹配，失败清空 selectedSegmentCode。
- [ ] 运行目标测试，再运行 `npm test` 与 `npm run build`。

## Task 3: 文档与提交
Files: `docs/superpowers/plans/2026-10-28-route-consistency.md`, `README.md`
- [ ] 文档说明输入变化使路线失效，补充实际验证结果。
- [ ] `git diff --check` 并检查暂存文件，只提交本轮文件。
- [ ] 提交代码与记录，最终检查 Git 状态和提交编号。
