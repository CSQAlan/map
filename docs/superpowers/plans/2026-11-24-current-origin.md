# Current origin Implementation Plan

> Execute inline task-by-task. User approved the design direction and delegated routine choices.

**Goal:** 从已收录道路中途开始适老规划，明确无覆盖边界，并展示路线登记指标。

**Architecture:** 独立 current_origin 纯几何服务处理投影/临时边；routes API 核验定位并复用原算法；前端共享起点状态与定位组件，不持久化坐标。

**Tech Stack:** FastAPI/PostGIS、Vue 3、Capacitor Geolocation、node:test、pytest、Playwright。

- [x] 检查现有定位、路线接口、路网、地图几何及用户确认的设计；呈现无覆盖边界，采用原绿色界面，无需新视觉方向选择。
- [x] 新增 `backend/app/services/current_origin.py`：折线投影、20 米范围、精度校验、保守临时有向边；用 `backend/tests/test_current_origin.py` 覆盖中途/端点/拒绝条件。
- [x] 扩展 `backend/app/api/routes/routes.py` 与 `schemas/routes.py`：候选起点端点、坐标起点参数组、范围核验及接入上下文；扩展 `backend/tests/test_routes_api.py` 验证旧 API 与新坐标流程。
- [x] 扩展 `frontend/src/services/deviceLocation.js` 保留 accuracy/timestamp；增加共享起点定位组件与状态；在首页/出行条件页接入，定位重试/确认/失效均有明确提示。
- [x] 扩展 `useRoutePlanner.js` 处理定位起点、坐标请求与过期拒绝；增加 node 测试，手动起点继续兼容。
- [x] 路线卡片添加真实登记指标；定位路线地图/文字首段使用裁剪后的几何，保持原始路段代码关联。
- [x] 增加浏览器定位模拟验收；运行相关后端测试、前端测试和生产构建；审阅变更，更新生产预览、说明与验证证据。

实施参考：以 `getCurrentCoordinates()` 的 WGS84 输出构造 `{longitude, latitude, accuracy, timestamp}`，时间最多 60 秒。每次候选/规划请求都传递画像；后端在 `/recommend` 再次投影并核验选中的 segment_code，避免将客户端候选视作可信路网。

## 交付与验收

- 实际文件补充：`frontend/src/components/elder/CurrentOriginPicker.vue`、`frontend/src/composables/useCurrentOrigin.js`、`frontend/src/services/routeOriginMap.js`、`frontend/src/components/RouteAccessibilityFacts.vue`、`frontend/tests/current-origin.test.js`、`frontend/scripts/check-current-origin.mjs`。
- 道路候选默认不选中，必须主动选择允许的道路再确认；定位开始时无条件使已有路线及待返回的手动路线请求失效。独立审阅发现的旧请求抢先跳转问题已修复，复审无阻断项。
- 台阶、坡度与路宽均标明为登记资料；部分路段保持整段风险，不凭空定位台阶。路线地图在 GCJ02 下裁剪首段，并显示接入点，保留证据关联。
- 前端 node:test：84 项通过；后端 current-origin/routes/planner/coordinates：40 项通过；最终类型模型改动后相关 18 项再次通过。
- `npm run test:origin`：在 320/390/768/1440px 下，以模拟 GPS 和真实数据库/API 验证确认前不使用定位、路段中途规划/导航、无覆盖拒绝及手动回退。最终生产预览 4173 同样通过。首段 92 米从中途开始，加后续 154 米，推荐约 200 米，坐标取整存在厘米级差异。
- `npm run test:ui` 24 布局与路线/助手流程通过；`npm run test:map` 通过；生产构建成功，git diff --check 无空白错误。
- 截图与报告保存在被忽略的 `frontend/artifacts/current-origin/`。未声称真实手机 GPS 已验收，未重新打包 APK。
- 预览：`http://localhost:4173/?refresh=20261124-location#/elder/home`；后端 8000。只新增内存临时节点，不修改数据库路网和原始踩点资料。
