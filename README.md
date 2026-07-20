# 助老地图 MVP

面向老年人安全出行、家属关怀和路段数据治理的无障碍地图试点项目。当前以重庆师范大学师大苑及周边为试点，提供适老路线推荐、地图导航、健康画像、家属端位置与行程查看、现场采集、后台审核及照片证据展示。

## 主要功能

- 老人端：大字号首页、地点选择、语音输入、路线推荐、导航提示和紧急求助
- 路线规划：按轮椅、拐杖、慢行等画像及安全/省力策略进行候选路线排序
- 家属端：老人绑定、位置与行程查看、异常提醒和授权说明
- 数据采集：移动端路段现场采集、定位、指标录入和审核流程
- 管理后台：用户状态、路段数据和采集记录管理
- 地图证据：高德地图、试点路网、现场照片与路段双向联动；地图不可用时提供降级视图
- 响应式布局：桌面端保留宽屏工作区，平板和手机端自动切换为单栏、底部导航及触控友好排版

## 技术栈

- 前端：Vue 3、Vite、原生 CSS
- 后端：Python 3.11、FastAPI、SQLAlchemy、Pydantic
- 数据库：PostgreSQL 16、PostGIS 3.4
- 测试：Pytest、Vite production build

## 目录结构

```text
backend/       FastAPI 应用、接口、模型、种子数据及测试
db/            PostGIS 初始化 SQL
docs/          架构、实施、采集规范及设计文档
frontend/      Vue 3 H5 与管理端
scripts/       Windows 本地启动脚本
deliverables/  项目交付文档
```

## 环境要求

- Conda（推荐）或 Python 3.11
- Node.js 18+ 与 npm
- Docker Desktop（用于 PostgreSQL/PostGIS）
- 可选：高德地图 Web 端 JS API Key 与安全密钥

## 快速启动

### 1. 安装 Python 环境

在项目根目录执行：

```powershell
conda env create -f environment.yml
conda activate elder-map-py311
```

### 2. 启动数据库

```powershell
docker compose -f docker-compose.postgis.yml up -d
```

默认数据库为 `elder_map`，地址 `127.0.0.1:5432`，用户名和密码均为 `postgres`。生产环境请务必修改默认凭据。

### 3. 配置环境变量

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
```

如需加载真实高德地图，在 `frontend/.env.local` 填写：

```dotenv
VITE_AMAP_KEY=你的 Web 端 JS API Key
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

也可使用兼容变量 `VITE_AMAP_SECURITY_JS_CODE`。本地环境文件已被 Git 忽略，请勿提交密钥。

### 4. 初始化地图数据

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
python -m app.scripts.init_map_data
```

### 5. 启动前后端

分别打开两个 PowerShell 窗口，在项目根目录执行：

```powershell
scripts\start-backend.cmd
```

```powershell
scripts\start-frontend.cmd
```

也可以运行 `scripts\launch-dev.cmd` 同时启动。常用地址：

- 前端：<http://127.0.0.1:5173/>
- 后端：<http://127.0.0.1:8000/>
- API 文档：<http://127.0.0.1:8000/docs>

## 手机端访问

响应式断点包括桌面、平板/小屏电脑、手机（`760px` 以下）和窄屏手机（`420px` 以下）。桌面端原布局不变；手机端会自动改为单栏内容、触控尺寸按钮、可横向滚动的数据表和固定底部导航。

1. 确保手机与电脑连接同一 Wi-Fi。
2. 在电脑运行 `ipconfig`，找到当前网络的 IPv4 地址，例如 `192.168.1.10`。
3. 手机浏览器打开 `http://192.168.1.10:5173/`。
4. 确保 Windows 防火墙允许局域网访问 `5173` 和 `8000` 端口。

Vite 已监听局域网地址，前端会请求同一台电脑的 `8000` 端口。普通 HTTP 局域网页面中的浏览器定位可能受安全策略限制；正式部署建议使用 HTTPS。

## 响应式布局说明

响应式样式集中在 `frontend/src/styles.css` 的 “Responsive layout layer” 区域，采用 desktop-first：

- `> 1024px`：保留现有电脑端双栏/宽屏布局
- `761px–1024px`：工作区和导航页切换为单栏，统计卡片改为两列
- `<= 760px`：页面统一收紧边距，表单与主要内容单列，地图高度适配视口，后台菜单横向滚动
- `<= 420px`：标签、统计卡片进一步切换为单列，标题和容器间距适配窄屏

页面已包含 viewport 配置。新增页面时请复用现有布局类，并把新的手机端覆盖规则放在基础组件样式之后，避免影响桌面端声明。

## 验证与构建

后端测试：

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
python -m pytest backend\tests -q
```

前端生产构建：

```powershell
Set-Location frontend
npm install
npm run build
```

建议同时使用浏览器开发者工具检查 `375px`、`390px`、`768px` 和桌面宽度，并在真机验证输入框、底部导航、地图手势及后台表格。

## 照片证据资源

现场原图保留在本地采集目录，不直接提交 Git。更新原图或首次运行后，可生成网页使用的 WebP 缩略图和展示图：

```powershell
Set-Location backend
python -m app.scripts.build_photo_derivatives --source "..\你的原图目录"
Set-Location ..
```

脚本只处理 `backend/app/db/seed_data/photo_manifest.json` 中登记的照片，不修改原图。生成资源位于 `backend/app/static/evidence/`。

## 配置与安全提示

- 当前默认账号、数据库密码和本地采集接口仅用于开发与演示。
- 对外部署前应更换密钥与密码，限制 CORS 来源，并为登录、采集和管理接口补充正式鉴权。
- 不要提交 `.env`、`.env.local`、高德密钥、真实个人信息或未经处理的现场原图。
- 生产环境应启用 HTTPS，并配置数据库备份、日志脱敏和权限分级。

## 相关文档

- `助老地图-系统架构设计.md`：系统架构与模块设计
- `助老地图-数据库设计与采集标准.md`：数据库模型与采集字段标准
- `助老地图-重庆师大试点实施计划.md`：试点实施安排
- `docs/data-collection/`：移动采集手册、评分规则和模板
- `docs/助老地图-当前进度与剩余任务.md`：当前进度与待办

## 常见问题

**地图没有显示怎么办？** 先检查 `frontend/.env.local` 的 Key 与安全密钥是否正确、对应域名是否已加入高德控制台白名单。项目会在真实地图加载失败时显示降级地图。

**手机能打开页面但接口失败怎么办？** 检查后端是否监听 `8000` 端口、手机与电脑是否处于同一局域网，以及防火墙是否放行对应端口。

**修改环境变量后没有生效怎么办？** 停止并重新启动 Vite 开发服务器；`VITE_` 开头的变量在启动时读取。
