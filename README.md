# 助老地图 MVP

面向比赛演示的“助老地图”试点项目，当前试点范围为重庆师范大学。项目已实现基础后端、PostGIS 数据库初始化、路线推荐 API，以及 Vue 3 H5 演示页。

## 技术栈

- Backend: Python 3.11, FastAPI, SQLAlchemy, PostgreSQL/PostGIS
- Frontend: Vue 3, Vite, native CSS
- Database: Docker Compose + `postgis/postgis:16-3.4`

## 本地启动

1. 创建并激活 Conda 环境。

```powershell
conda env create -f environment.yml
conda activate elder-map-py311
```

2. 启动 PostGIS。

```powershell
docker compose -f docker-compose.postgis.yml up -d
```

3. 准备后端环境变量。

```powershell
Copy-Item backend\.env.example backend\.env
```

4. 初始化数据库和种子数据。

```powershell
$env:PYTHONPATH=(Resolve-Path backend).Path
python -m app.scripts.init_map_data
```

5. 启动后端和前端。

```powershell
scripts\start-backend.cmd
scripts\start-frontend.cmd
```

前端访问地址：`http://127.0.0.1:5173/`

## 验证命令

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
cd frontend
npm.cmd run build
```

## 当前能力

- 三号门到校医院/食堂的步行路线推荐
- 基于老人画像的 TOP 候选路线排序
- H5 推荐模式和老人模式切换
- 老人模式大字提示、大按钮、模拟导航和模拟求助
