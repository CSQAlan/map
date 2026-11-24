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

- [ ] 增加读取失败、乱序和管理员保存期间切换的回归测试；用两个 deferred Promise 后发先至确认旧响应不得覆盖新数据。

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

- [ ] 加入 sitesLoading、reload、dispose；每种读取单独 AbortController、timeout、generation。切换筛选时同步失效旧状态；请求完成仅当前 generation 能落库到 ref。
- [ ] 保存请求快照 record_code、site_code、coordinates；结果只作用于原记录，读刷新不得覆盖已切换记录的操作。
- [ ] 运行 `node --test tests/survey-records.test.js`，要求网络错误中文、乱序安全和原 GCJ02/Bearer 测试通过。

### Task 2: 地图生命周期

Files: 修改 `frontend/src/components/SurveyRecordsMap.vue`。

- [ ] 将固定 id 改为 `ref="container"`，加入 loading/ready/error 状态、12 秒 deadline、generation 和 disposed 检查。

```js
const attempt = ++generation;
const sdk = await loadAmap();
if (disposed || attempt !== generation) return;
// Only create the map for a live container/current attempt.
```

- [ ] 初始化前清理上一实例；地图 complete 清除 deadline，超时与错误清理实例并提供“重新加载地图”；卸载使 promise 和搜索回调失效。
- [ ] 标记更新始终删除旧 placementMarker，避免无坐标记录保留上一记录的＋。

### Task 3: 可恢复的资料页面

Files: 修改 `frontend/src/pages/SurveyRecordsPage.vue`、`frontend/src/pages/AdminSurveyPlacementPage.vue`；新增 `frontend/src/styles/survey-browser.css`。

- [ ] 页面挂载并行 reload，卸载 dispose；地点选项动态计数；失败区明确“重新加载资料”。
- [ ] 全量记录列表与照片不依赖地图；手机默认收起地图，大屏分栏；选中项有 aria-pressed，图片失败允许重新载入。
- [ ] 大图使用原生 dialog 模态、关闭/左右切换、焦点恢复；用 key 按图片区分失败状态；删掉未生效的旧图片翻页状态。
- [ ] 管理员页面接入共享请求生命周期、动态地点数、读失败重试与保存禁用条件，不改变接口与审核语义。

### Task 4: 验证与交付

Files: 新增 `frontend/scripts/check-survey-browser.mjs`，修改 `frontend/package.json`、`README.md`。

- [ ] Playwright 独立 fixtures 验证加载故障→重试→全部记录可浏览，图片失败→重试，原生 dialog 关闭焦点恢复；320/390/768/1440 检查 `scrollWidth <= clientWidth + 1`。
- [ ] SDK 注入检查拒绝、超时、重新加载和离开页面晚到不创建地图。输出截图到被忽略的 artifacts/survey-browser。
- [ ] 运行 `npm test`、`npm run build`、`npm run test:survey`。启动预览时显式对应刚构建的 dist，避免展示旧 dist-review。
- [ ] 检查本地后端与数据库；真实接口可用则读取 sites/records/照片返回状态；失败记录实际限制。
- [ ] 审阅本轮 diff、修正重要问题、更新复现实验说明及本计划勾选状态，交付当前预览链接。

## 自审

每项验收对应任务；只读重试、写请求快照和地图生命周期边界明确。记录与照片均由已有 API 提供，脚本 fixtures 只用于确定性验证，不作为真实数据。无额外包安装或模型下载。
