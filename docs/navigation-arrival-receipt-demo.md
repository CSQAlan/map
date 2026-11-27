# 到达确认与行程回执：本地演示

## 使用与边界

普通导航点击“结束导航”或末段的“核对目的地并结束”，默认聚焦“继续导航”。选择“我已到达（本人确认）”才记录 arrived；选择“结束但未确认到达”记录 unconfirmed，不表示没有到达。Escape、“关闭”和“继续导航”返回原触发按钮，不生成回执；直接查看路线方案也不生成。

结束后路线选项页显示只读回执。“当前正在走第几段”沿用当前指引索引；“手动标记确认了 N 段 / 共 M 段”使用独立集合，不能拿可前进、回退、清零的索引推算。点击“已走完这段”确认当前段并前进；回退后重复确认不重复计数；末段的“手动确认最后一段已走完”只记段数。打开末段结束弹窗、确认到达都不补计段数。0/M 可以本人确认到达，M/M 也可以结束但未确认到达。

回执仅含 outcome、confirmed、total，不含身份、路线名称、时间、坐标或实际经过记录。不写 localStorage/sessionStorage，不发送给家属。换路线、修改出行条件、开始新行程、身份会话变化（包括再次进入游客模式）、离开导航/路线选项页、纯退出、刷新或卸载会清除。异步开始、旧会话事件及旧弹窗回调须匹配当前会话；旧结束请求迟到不能覆盖新回执或新结束状态。新行程的计数从零开始，原有指引索引行为保留。

绕行和暂停绕行保留原结束路径，不生成此回执，不混算普通路线。家属端仍使用已有 COMPLETED 和“用户已结束导航，是否到达请本人确认。”，双击仅提交一次；游客没有新增同步。文字路线保存、返程入口及“可中途休息”相关显示保持原有行为。

前端负责手动选择、会话隔离及回执展示；后端继续提供登记路线与现有导航快照，本次无接口/数据模型变化。已读 README、stage1_route_selection、后端路由/auth、导航发布器和导航状态实现。stage1 文档实际是课程选题记录，没有把它当成本功能规格。普通账户目前没有可可靠核验身份的会话凭据，家属共享仍是演示边界，因此 SOS 延后，本轮不改鉴权或求助业务。

## 45 秒录制脚本

使用本地合成的三段路线，不登录真实账号。可先运行下面的新增浏览器命令复现完整流程；脚本自行启动隔离 Vite、拦截所有 API，并在结束时关闭浏览器。

- 0–8 秒：开始普通导航，指出“当前第 1 段”和“手动确认 0/3”是两件事。
- 8–18 秒：点“已走完这段”，回退，再确认同一段。展示当前第 2 段，手动确认仍是 1/3。
- 18–25 秒：点“结束导航”，展示默认“继续导航”；按 Escape，焦点回到结束按钮。
- 25–35 秒：再次结束，选择“我已到达（本人确认）”。展示回执“本人确认到达，手动确认 1/3”，说明这不是 GPS 或实际经过证明。
- 35–45 秒：指出返程入口仍在；开始新行程，回执清除。说明另一个结束选项只表示未作到达确认，不表示未到达。

## 实际验证

在 `frontend` 执行，使用已有依赖和 Chrome，无安装、正式服务或真实账号数据：

```powershell
node --test tests/navigation-arrival-receipt.test.js
node --test tests/navigation-arrival-page.test.js tests/navigation-arrival-receipt.test.js
node --test --test-concurrency=4
npm run build
node scripts/check-navigation-arrival.mjs --no-artifacts
node scripts/check-return-journey.mjs --no-artifacts
node scripts/check-navigation-regression.mjs
node scripts/check-navigation-obstruction.mjs --no-artifacts
node scripts/check-navigation-large-text.mjs
node scripts/check-navigation-memo.mjs --no-artifacts
node scripts/check-navigation-photo-cue.mjs --no-artifacts
node scripts/check-navigation-ahead.mjs --no-artifacts
node scripts/check-navigation-show-step.mjs --no-artifacts
```

结果：新增针对性测试 14/14；四并发完整单测 689/689，失败/跳过均为 0；Vite build 成功（152 modules）。新增浏览器检查 11 个场景、现有返程 16 个场景通过。地图/语音/GPS/休息、绕行结束、大字、文字路线下载、实景、前方情况及展示路段检查全部通过。新增检查验证两种明确结果、取消/纯退出、重复提交、回退去重、0/M 与 M/M、路线/身份/离页/刷新/新行程清理、旧结束请求失败迟到、无新增共享字段，以及 320px/150% 字体和键盘焦点/Tab 循环。原有大字/展示路段检查还覆盖 200%。使用根字体缩放，不等同于真机系统字体或所有浏览器缩放机制。

另实际运行过 `node scripts/check-navigation-arrival.mjs`，生成 320px/150% 截图并检查回执换行和布局；本轮截图、构建输出和临时日志不作为交付文件保留。`check-navigation-regression.mjs` 生成的本地截图也已清理。

红绿记录：先加回执测试，因模块尚不存在按预期失败，再实现后通过。完整测试最初因普通/绕行共用旧按钮断言失败，已分别保留绕行旧断言并更新普通断言。浏览器曾检出“再次进入游客模式”未清除，改为监听现有会话序号后通过；新增旧弹窗回调测试也曾失败，绑定每个弹窗实例的处理函数后通过。最终无遗留失败。内置浏览器连接初始化失败，浏览器验证使用仓库已有的本地 Playwright/Chrome 脚本完成。

未测：物理手机、真实 GPS/地图 SDK、系统读屏、Android WebView 和真实家属服务；键盘与 ARIA 结构检查不能替代读屏实测。本功能不是到达证明或安全保障。

## 改动文件

- 业务：`frontend/src/App.vue`、`frontend/src/pages/NavigationPage.vue`、`frontend/src/pages/RouteOptionsPage.vue`；新增 `frontend/src/composables/useNavigationReceipt.js`。
- 新增测试：`frontend/tests/navigation-arrival-receipt.test.js`、`frontend/tests/navigation-arrival-page.test.js`、`frontend/scripts/check-navigation-arrival.mjs`。
- 现有普通结束断言适配：`frontend/tests/navigation-{brief-page,large-text-page,memo-page,photo-cue-page,rest,show-step-page}.test.js`；绕行旧断言保留。
- 现有浏览器按钮断言适配：`frontend/scripts/check-navigation-{ahead,large-text,memo,obstruction,photo-cue,show-step}.mjs`、`frontend/scripts/check-return-journey.mjs`、`frontend/scripts/check-speech-navigation.mjs`。
- 文档：本文件。未改后端、SOS、导航同步字段、鉴权、依赖或休息标签；未 stage、commit、push，未访问原项目目录或生产。
