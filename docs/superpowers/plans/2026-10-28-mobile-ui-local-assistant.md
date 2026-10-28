# Mobile UI and local assistant Implementation Plan

> **For agentic workers:** 当前会话逐项实施，用户已授权自行审批；提交前独立代码审查。

**Goal:** 手机优先视觉升级和本地qwen3.5:4b助手。
**Architecture:** 沿用Vue页面宿主，新增助手页面/composable；后端schema/service/router分层，通过httpx连接Ollama。
**Tech Stack:** Vue 3、Vite、FastAPI、Pydantic、httpx、Ollama。

## Task 1: 手机界面
- [ ] 创建AppIcon.vue，修改ElderLayout.vue、ElderPage.vue，保留emit契约。
- [ ] 更新tokens.css、新增mobile-refresh.css并由main.js导入，统一登录、路线、底栏。
- [ ] 注册assistant路由，审查并保存现有router修正。

## Task 2: 本地推理
- [ ] 创建schemas/assistant.py、services/assistant.py、api/routes/assistant.py，注册路由和配置。
- [ ] 限制输入、历史、token、超时和并发，映射中文错误。
- [ ] 添加test_assistant_api.py并mock网络边界。

## Task 3: 助手页面
- [ ] 创建useAssistant.js、AssistantPage.vue，发送/失败恢复/取消/清空/离页清理。
- [ ] App.vue接入有限路线摘要，支持上下文开关，纯文本显示。
- [ ] 添加assistant.test.js覆盖状态和消息边界。

## Task 4: 验证交付
- [ ] 前端测试、生产构建、后端测试和真实Ollama生成。
- [ ] 多宽度浏览器检查并截图，修复溢出/遮挡。
- [ ] 更新README、计划，独立审查、git diff --check，提交代码与文档。
