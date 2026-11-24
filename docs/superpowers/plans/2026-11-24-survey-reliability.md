# 踩点资料可靠浏览 Implementation Plan

> **For agentic workers:** Execute task-by-task in this session. The referenced superpowers execution skills are not installed; use the existing node:test and Playwright workflows and review the completed diff. User authorized automatic routine design approval.

**Goal:** 在接口或地图故障时仍提供清晰、可恢复的踩点浏览体验，保护筛选与管理员补点状态。

**Architecture:** 保持 useSurveyRecords 为状态边界，页面组织全部记录与照片，SurveyRecordsMap 自主管理 SDK 生命周期。仅重试用户触发的读请求，保存保持既有认证协议。

**Tech Stack:** Vue 3、Vite、原生 CSS、node:test、Playwright、既有 FastAPI/PostGIS。

---

## 工作清单与文件

- [x] 检查文件、文档和近期提交；未跟踪原图与研究资料保持原状。
- [x] 根据用户既有偏好确认目标和约束；无新视觉方案选择，直接沿用现有 tokens，无需视觉伴侣。
- [x] 比较助手扩展、全站视觉与踩点可靠性三个方向并呈现设计；沿用用户自动批准授权。
- [x] 写设计、自审并进入 writing-plans；用户可随时查阅 spec，授权覆盖常规文档确认。

### Task 1: 请求与状态恢复

Files: 修改 `frontend/src/composables/useSurveyRecords.js`；扩展 `frontend/tests/survey-records.test.js`。

- [x] 增加读取失败、乱序和管理员保存期间切换的回归测试；用两个 deferred Promise 后发先至确认旧响应不得覆盖新数据。

```js
const pending = [];
globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
const first = workflow.loadRecords();
const second = workflow.loadRecords();
pending[1](jsonResponse({ features: [newFeature] }));
await second;
pending[0](jsonResponse({ features: [oldFeature] }));
await first;
assert.equal(workflow.selectedRecordCode.value, newFeature.properties.record_code);
```

- [x] 加入 sitesLoading、reload、dispose；每种读取单独 AbortController、timeout、generation。切换筛选时同步失效旧状态；请求完成仅当前 generation 能落库到 ref。
- [x] 保存请求快照 record_code、site_code、coordinates；结果只作用于原记录，读刷新不得覆盖已切换记录的操作。
- [x] 运行 `node --test tests/survey-records.test.js`，要求网络错误中文、乱序安全和原 GCJ02/Bearer 测试通过。

### Task 2: 地图生命周期

Files: 修改 `frontend/src/components/SurveyRecordsMap.vue`。

- [x] 将固定 id 改为 `ref="container"`，加入 loading/ready/error 状态、12 秒 deadline、generation 和 disposed 检查。

```js
const attempt = ++generation;
const sdk = await loadAmap();
if (disposed || attempt !== generation) return;
// Only create the map for a live container/current attempt.
```

- [x] 初始化前清理上一实例；地图 complete 清除 deadline，超时与错误清理实例并提供“重新加载地图”；卸载使 promise 和搜索回调失效。
- [x] 标记更新始终删除旧 placementMarker，避免无坐标记录保留上一记录的＋。

### Task 3: 可恢复的资料页面

Files: 修改 `frontend/src/pages/SurveyRecordsPage.vue`、`frontend/src/pages/AdminSurveyPlacementPage.vue`；新增 `frontend/src/styles/survey-browser.css`。

- [x] 页面挂载并行 reload，卸载 dispose；地点选项动态计数；失败区明确“重新加载资料”。
- [x] 全量记录列表与照片不依赖地图；手机默认收起地图，大屏分栏；选中项有 aria-pressed，图片失败允许重新载入。
- [x] 大图使用原生 dialog 模态、关闭/左右切换、焦点恢复；用 key 按图片区分失败状态；删掉未生效的旧图片翻页状态。
- [x] 管理员页面接入共享请求生命周期、动态地点数、读失败重试与保存禁用条件，不改变接口与审核语义。

### Task 4: 验证与交付

Files: 新增 `frontend/scripts/check-survey-browser.mjs`，修改 `frontend/package.json`、`README.md`。

- [x] Playwright 独立 fixtures 验证加载故障→重试→全部记录可浏览，图片失败→重试，原生 dialog 关闭焦点恢复；320/390/768/1440 检查 `scrollWidth <= clientWidth + 1`。
- [x] SDK 注入检查拒绝、超时、重新加载和离开页面晚到不创建地图。输出截图到被忽略的 artifacts/survey-browser。
- [x] 运行 `npm test`、`npm run build`、`npm run test:survey`。启动预览时显式对应刚构建的 dist，避免展示旧 dist-review。
- [x] 检查本地后端与数据库；真实接口可用则读取 sites/records/照片返回状态；失败记录实际限制。
- [x] 审阅本轮 diff、修正重要问题、更新复现实验说明及本计划勾选状态，交付当前预览链接。

## 自审

每项验收对应任务；只读重试、写请求快照和地图生命周期边界明确。记录与照片均由已有 API 提供，脚本 fixtures 只用于确定性验证，不作为真实数据。无额外包安装或模型下载。

## 实施结果与证据

- 数据请求、图片组件、模态查看器、地图恢复及管理员接入均已完成。独立审阅提出的 SDK 重试缓存、晚到脚本并发和新草稿提示问题已修复，复审无阻断项。
- 手机原生记录选择框替代长列表，照片优先；桌面保留记录侧栏。已人工查看真实数据手机与桌面截图。
- 地图 SDK 普通错误原地重试；超时改为明确整页刷新，防止全局 callback 被旧脚本复用。导航共用 SDK 的成功加载保持缓存。
- 联调补充修复 `backend/app/db/seeds.py` 的 site_name 绑定和坐标 NULL 参数类型，以及 `backend/app/api/routes/survey_records.py` 的可空 site_code 类型。新增 `backend/tests/test_survey_postgis.py` 在临时表和回滚事务中验证真实导入、重复导入保留位置/审核状态及无筛选 API。
- 本地启动已有 Docker Desktop 和 elder-map-db；仅应用现有 schema 的独立踩点建表部分并导入原清单，真实数据为 7 个地点、67 条记录，46 条待补位置。未重置导航路网、未改原图与清单。
- `npm test`：77 通过；`npm run test:survey`：4 种宽度及故障/图片/模态/地图生命周期检查通过；`npm run test:map` 通过；`npm run test:ui`：24 布局检查及 4 条路线/导航、4 条助手流程通过。
- 后端针对 seed loader、survey API、archive 和真实 PostGIS 测试合计 28 通过（RUN_SURVEY_DB_TESTS=1），其中真实数据库测试在临时表内执行并回滚。
- 生产构建成功。真实生产预览 390px/1440px 均加载 67 条记录及照片，无横向溢出、无运行异常；桌面高德地图 complete 且瓦片 HTTP 成功。沙箱内请求曾被 ERR_NETWORK_ACCESS_DENIED 阻止，获准在沙箱外浏览器验证后恢复。
- 报告/截图：`frontend/artifacts/survey-browser/checks.json`、`production-checks.json`、`production-390.png`、`production-1440.png`；只作为本地验收产物，不加入 Git。
- 当前预览：`http://localhost:4173/?refresh=20261124#/elder/survey`，后端 8000。生产静态服务读取最新 `frontend/dist`。
