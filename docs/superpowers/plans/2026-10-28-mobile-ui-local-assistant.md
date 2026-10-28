# Mobile UI and local assistant Implementation Plan

> **For agentic workers:** 当前会话逐项实施，用户已授权自行审批；提交前独立代码审查。

**Goal:** 手机优先视觉升级和本地qwen3.5:4b助手。
**Architecture:** 沿用Vue页面宿主，新增助手页面/composable；后端schema/service/router分层，通过httpx连接Ollama。
**Tech Stack:** Vue 3、Vite、FastAPI、Pydantic、httpx、Ollama。

## Task 1: 手机界面
- [x] 创建AppIcon.vue，修改ElderLayout.vue、ElderPage.vue，保留emit契约。
- [x] 更新tokens.css、新增mobile-refresh.css并由main.js导入，统一登录、路线、底栏。
- [x] 注册assistant路由，审查并保存现有router修正。

## Task 2: 本地推理
- [x] 创建schemas/assistant.py、services/assistant.py、api/routes/assistant.py，注册路由和配置。
- [x] 限制输入、历史、token、超时和并发，映射中文错误。
- [x] 添加test_assistant_api.py并mock网络边界。

## Task 3: 助手页面
- [x] 创建useAssistant.js、AssistantPage.vue，发送/失败恢复/取消/清空/离页清理。
- [x] App.vue接入有限路线摘要，支持上下文开关，纯文本显示。
- [x] 添加assistant.test.js覆盖状态和消息边界。

## Task 4: 验证交付
- [x] 前端测试、生产构建、后端测试和真实Ollama生成。
- [x] 多宽度浏览器检查并截图，修复溢出/遮挡。
- [x] 更新README、计划，独立审查、git diff --check，提交代码与文档。

## 完成与验证

- 更新手机首页、SVG图标/步道插画、五项导航、登录和路线卡；桌面维持分栏。统一颜色变量到tokens.css。
- 完成本地Ollama代理、受限结构化输入、固定system、超时/容量控制与中文错误；助手只在页面内存保存会话，支持取消、清空、失败恢复和可选路线摘要。
- 新增Playwright开发依赖及test:ui、test:assistant:live脚本，使用本机已安装Chrome，不自动下载浏览器。
- npm test：51/51通过。后端140通过、3个显式开启的PostGIS集成测试跳过。
- test:ui：24个页面/宽度布局检查、4条路线导航流程、4条带路线摘要的模拟助手流程通过；320/390宽度×560高度输入与底栏不重叠。
- test:assistant:live：真实浏览器到FastAPI到qwen3.5:4b链路返回中文；两次页面验证约10秒与7秒。截图包含真实模型回答。
- 独立审查发现旧连接检查可能覆盖成功对话状态，已修复、增加测试并通过复核；无剩余阻塞问题。
- 短视口采样需等待两帧媒体查询布局完成，已加入浏览器检查，避免读取旧矩形；截图已目视审查。
- 本轮未构建APK，也未做物理手机、真实地图Key、真实PostGIS现场路网验收。
- 使用说明见docs/local-assistant.md。原始照片、map.zip与既有dist-review不提交；既有路由注册修正已纳入本次审查和提交。
