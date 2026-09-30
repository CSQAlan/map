# 大学城踩点资料导入与地图实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入 `map.zip` 的 122 张照片为独立待核查踩点记录，并提供老人可读的地图优先浏览和管理员补位置功能。

**Architecture:** Python 导入器从嵌套 ZIP 提取 JPG/PNG/HEIC，生成去 EXIF 的 WebP 与稳定清单；PostGIS 保存记录与 WGS84 点位，不复用正式 `pilot_area`/路网。FastAPI 暴露只读地图 API 和 HMAC 管理员令牌保护的位置更新 API，Vue 新增独立资料地图与后台落点工作区。

**Tech Stack:** FastAPI、SQLAlchemy text/PostGIS、Pillow + pillow-heif、Vue 3、AMap JS API 2.0、pytest、Vite。

---

### Task 1: 归档导入、清单和 WebP 资源

**Files:**
- Create: `backend/app/scripts/import_survey_archive.py`
- Create: `backend/app/db/seed_data/survey_records.json`
- Create: `backend/app/static/evidence/survey/thumb/*.webp`
- Create: `backend/app/static/evidence/survey/display/*.webp`
- Modify: `environment.yml`
- Test: `backend/tests/test_survey_archive_import.py`

- [ ] **Step 1: 写导入器单元测试**

用内存中的嵌套 ZIP fixture 覆盖：安全路径校验、稳定 ID、map 截图与现场图按 stem 配对、地图-only 图保留、GPS 转十进制度，以及坏图报告失败。测试明确断言导出的图片元数据为空，清单记录保留 `source=EXIF` 或 `source=NONE`。

- [ ] **Step 2: 实现可重复导入器**

`build_archive(archive_path, manifest_path, media_root)`：逐个读取外层 ZIP 的子 ZIP，不落盘原图；中文乱码名按 ZIP 元数据回退解码；过滤绝对路径与 `..`；调用 `pillow_heif.register_heif_opener()`；生成 thumb 480px/quality 76 与 display 1600px/quality 84 WebP；提取 GPS 后再保存图像，确保输出不含 EXIF。每个媒体 ID 由地点代码和规范化原始相对路径 SHA-256 前 16 位组成。所有原图文件都出现在 manifest 恰好一次，地图截图可作为 record 的 `map_reference` 媒体，不确定配对时单独成记录。

- [ ] **Step 3: 安装 HEIC opener 并生成正式数据**

在 `environment.yml` 添加 `pillow-heif`。运行：

```powershell
cd F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m app.scripts.import_survey_archive --archive ..\map.zip
```

预期：7 个地点，122 个源媒体；所有图片都生成缩略图/展示图，清单报告 JPG/PNG/HEIC 数量、GPS 数量、配对/孤立数，坏图数为 0。原始 ZIP 不改写、不暂存。

- [ ] **Step 4: 跑导入器测试并审阅清单**

运行：

```powershell
cd F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m pytest tests\test_survey_archive_import.py -q
```

确认清单 122 个唯一媒体 ID、地点标签没有乱码、EXIF GPS 仅存在 JSON 坐标字段而不出现在 WebP。

- [ ] **Step 5: 提交数据导入单元**

```powershell
git add environment.yml backend/app/scripts/import_survey_archive.py backend/app/db/seed_data/survey_records.json backend/app/static/evidence/survey backend/tests/test_survey_archive_import.py
git commit -m "feat: import university city survey evidence"
```

### Task 2: PostGIS 表、幂等 seed 与只读资料 API

**Files:**
- Modify: `db/01_init_schema.sql`
- Modify: `backend/app/db/seeds.py`
- Modify: `backend/app/scripts/init_map_data.py`
- Create: `backend/app/services/survey_records.py`
- Create: `backend/app/schemas/survey_records.py`
- Create: `backend/app/api/routes/survey_records.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_survey_records_api.py`
- Test: `backend/tests/test_seed_loader.py`

- [ ] **Step 1: 锁定 API/seed 行为测试**

断言 `GET /api/survey-records/sites` 返回 7 个地点；`GET /api/survey-records?site_code=...&coordinate_system=GCJ02` 返回其待核查记录、图片 URL、位置状态与坐标系；没有位置的记录 geometry 为 null；未知地点 404、未知坐标系 422；普通地图 GeoJSON 和路线查询不包含 survey 数据。重复 seed 不能覆盖已保存的位置。

- [ ] **Step 2: 建立独立 PostGIS schema**

`survey_site(site_code PK, name, sort_order)` 和 `survey_record(record_code PK, site_id FK, title, issue_tags JSONB, media_refs JSONB, location GEOMETRY(Point,4326) NULL, location_source, review_status, updated_at)`。约束 `location_source IN ('NONE','EXIF','MANUAL')`、`review_status='PENDING_REVIEW'`，并为地点、状态和位置建索引。禁止 FK 到 `pilot_area`、`road_node`、`road_segment` 或 `poi_facility`。

- [ ] **Step 3: 实现幂等种子**

读取生成的 `survey_records.json`，upsert 地点和记录的标题/标签/媒体；仅在新记录插入时写入 EXIF 坐标。冲突更新不得修改现有 `location`、`location_source` 或审核状态。将该 seed 纳入 `init_map_data.py` 的返回统计。

- [ ] **Step 4: 实现只读 API**

创建 `GET /sites` 与 `GET /`；参数 `site_code` 可选，`coordinate_system` 限定 `WGS84|GCJ02`。geometry 用现有 `convert_geometry` 转换；媒体 URL 只能由清单的稳定 ID 与 thumb/display 变体组装，缺少清单项不返回可访问路径。

- [ ] **Step 5: 跑后端定向测试与提交**

```powershell
cd F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m pytest tests\test_survey_records_api.py tests\test_seed_loader.py -q
```

```powershell
git add db/01_init_schema.sql backend/app/db/seeds.py backend/app/scripts/init_map_data.py backend/app/services/survey_records.py backend/app/schemas/survey_records.py backend/app/api/routes/survey_records.py backend/app/api/router.py backend/tests/test_survey_records_api.py backend/tests/test_seed_loader.py
git commit -m "feat: add survey records API"
```

### Task 3: 管理员登录令牌和受保护的补位置 API

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/.env.production.example`
- Modify: `backend/app/api/routes/auth.py`
- Modify: `backend/app/services/coordinates.py`
- Modify: `backend/app/schemas/survey_records.py`
- Modify: `backend/app/api/routes/survey_records.py`
- Modify: `frontend/src/App.vue`
- Test: `backend/tests/test_survey_record_location_api.py`
- Test: `backend/tests/test_coordinates.py`

- [ ] **Step 1: 写安全边界测试**

无 token、篡改/过期 token、非管理员与停用管理员 PATCH 均返回 401/403；有效管理员可以保存合法坐标，保存后 `location_source='MANUAL'` 且 `review_status` 仍为 `PENDING_REVIEW`；越界/NaN/Infinity 坐标返回 422。

- [ ] **Step 2: 签发和核验短期 HMAC bearer token**

管理员登录成功时返回 8 小时 token；token payload 至少含 user id 和 expires-at，HMAC-SHA256 使用 `ADMIN_TOKEN_SECRET`。每次位置更新均回查 app_user 当前角色/状态。开发环境使用明确的开发默认值；production 环境未配置 secret 时拒绝令牌签发和写入。前端只在内存态保存 token，不写 localStorage。

- [ ] **Step 3: 实现坐标更新事务**

`PATCH /api/survey-records/{record_code}/location` 接收 `{longitude, latitude, coordinate_system: 'GCJ02'}`，用新增的 `gcj02_to_wgs84()` 数值迭代逆转换后存储 WGS84；限制经度 [-180,180]、纬度 [-90,90] 且拒绝 NaN/Infinity，更新位置和来源但不更新审核状态；未知 record 返回 404。事务提交后回传 GCJ-02 位置与仍待核查的状态。

- [ ] **Step 4: 跑定向安全测试并提交**

```powershell
cd F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m pytest tests\test_survey_record_location_api.py tests\test_coordinates.py -q
```

```powershell
git add backend/app/core/config.py backend/.env.example backend/.env.production.example backend/app/api/routes/auth.py backend/app/services/coordinates.py backend/app/schemas/survey_records.py backend/app/api/routes/survey_records.py frontend/src/App.vue backend/tests/test_survey_record_location_api.py backend/tests/test_coordinates.py
git commit -m "feat: protect survey pin placement"
```

### Task 4: 手机地图优先踩点浏览

**Files:**
- Create: `frontend/src/components/SurveyRecordsMap.vue`
- Create: `frontend/src/pages/SurveyRecordsPage.vue`
- Modify: `frontend/src/components/PageNavigation.vue`
- Modify: `frontend/src/services/amapLoader.js`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/styles.css`
- Test: `frontend` production Vite build

- [ ] **Step 1: 实现记录列表、地点筛选和空/失败状态**

页面展示“踩点资料｜待核查｜不参与路线推荐”的固定提示；地点筛选显示 7 个分组；已定位记录显示现场/地图截图缩略图与来源标签；未定位记录保留在列表，不合成地图坐标。选中记录展示可左右查看的照片详情。

- [ ] **Step 2: 实现独立 AMap markers**

增加全新容器 ID，不复用 SHIDAYUAN 地图实例。只渲染 geometry 非空的待核查标记；标记点击选中记录；筛选变化后清理旧覆盖物并重新绘制。地图脚本失败时仍渲染列表/照片并显示明确提示。加载 PlaceSearch 插件供管理员在不同地点间定位地图视野。

- [ ] **Step 3: 连接 API 和主导航入口**

`App.vue` 加载地点和记录、处理地点筛选/详情状态；普通用户从独立“踩点资料”入口进入，不改变默认师大苑导航流程。

- [ ] **Step 4: 建立适老窄屏布局并构建**

地图充满主区域，地点筛选和所选记录使用大触控目标底部面板；桌面使用地图+资料栏。运行：

```powershell
cd F:\items\map\frontend
npm run build
```

预期 Vite build 成功且输出包不包含 122 张原始图片。

- [ ] **Step 5: 提交地图浏览单元**

```powershell
git add frontend/src/components/SurveyRecordsMap.vue frontend/src/pages/SurveyRecordsPage.vue frontend/src/components/PageNavigation.vue frontend/src/services/amapLoader.js frontend/src/App.vue frontend/src/styles.css
git commit -m "feat: add elder-friendly survey map"
```

### Task 5: 管理员照片对照补位置

**Files:**
- Create: `frontend/src/pages/AdminSurveyPlacementPage.vue`
- Modify: `frontend/src/pages/AdminPage.vue`
- Modify: `frontend/src/App.vue`
- Test: `frontend` production Vite build

- [ ] **Step 1: 添加后台踩点定位入口与记录列表**

管理员后台增加“踩点定位”标签，按地点和“待定位/已有 GPS 待核查”筛选。详情并排显示现场图与配对地图截图、记录来源、状态和位置提示。

- [ ] **Step 2: 实现搜索/点击落点和保存**

AMap 地图接收管理员地图点击的 GCJ-02 坐标，PATCH payload 使用 `coordinate_system: 'GCJ02'`，由后端 `gcj02_to_wgs84()` 统一反转换后写入。带 bearer token 调用 PATCH；提供保存、取消、成功/失败反馈；成功只改变位置，不改变待核查状态。没有原坐标时保存按钮不可用，直到管理员点图。

- [ ] **Step 3: 验证 build、页面接线并提交**

```powershell
cd F:\items\map\frontend
npm run build
```

```powershell
git add frontend/src/pages/AdminSurveyPlacementPage.vue frontend/src/pages/AdminPage.vue frontend/src/App.vue
git commit -m "feat: add survey location review workspace"
```

### Task 6: 初始化/部署说明、全量审查与推送

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `environment.yml`
- Review: all commits since feature base

- [ ] **Step 1: 忽略 brainstorm scratch 并补初始化说明**

`.gitignore` 增加 `.superpowers/`。README 说明执行 `conda env update -f environment.yml`、`backend` 目录下运行 `python -m app.scripts.init_map_data`、启动前端/后端；注明原始 `map.zip` 不提交、WebP 由后端服务，因此 LAN APK 和 Docker 前端共用一份媒体资源。生产部署必须配置 `ADMIN_TOKEN_SECRET`。

- [ ] **Step 2: 执行完整后端/前端验证**

```powershell
cd F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m pytest -q
cd F:\items\map\frontend
npm run build
```

后端需要可用 PostGIS 才执行真实 schema/seed 集成检查；若数据库未启动，记录该项为未验证并运行不依赖数据库的单测。测试中确认 122 媒体完整、媒体输出无 EXIF、路由接口数据未改变。

- [ ] **Step 3: 代码审查并修复 Critical/Important 问题**

审查重点：zip-slip/压缩炸弹防护、中文 ZIP 名称、EXIF/HEIC 转换与元数据剥离、token 校验/生产 secret、坐标系、空位置及地图降级、seed 不覆盖落点、正式路线数据隔离、照片包体大小。

- [ ] **Step 4: 汇总提交并推送**

确认 `git status` 中只有功能源码、设计/计划文档和生成 WebP；不含 `map.zip`、解压原图、`IMG_...`、临时数据。所有功能提交推送到当前分支 `L` / `origin/L`，保留用户原始数据不动。
