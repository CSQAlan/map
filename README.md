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

### 手机端访问

前端开发服务已监听 `0.0.0.0:5173`。手机和电脑连同一个 Wi-Fi 后，在电脑上查看局域网 IP，例如 `192.168.x.x`，手机浏览器打开：

```text
http://电脑局域网IP:5173/
```

前端默认会请求同一台电脑的 `8000` 端口，例如 `http://电脑局域网IP:8000`，可用于手机采集模式现场录入数据。

如果手机打不开页面或接口，请检查 Windows 防火墙是否允许 `5173` 和 `8000` 端口访问。手机定位在普通 `http://局域网IP` 环境下可能被部分浏览器限制；比赛演示可以先不带定位提交，后续上线 HTTPS/PWA 后再稳定启用定位。

当前采集接口定位为本地/局域网比赛演示能力，暂未加入登录或采集口令；真实部署前需要补权限控制。

## 验证命令

```powershell
.\.conda\elder-map-py311\python.exe -m pytest backend\tests -q
cd frontend
npm.cmd run build
```

## 当前能力

- 三号门到校医院/食堂的步行路线推荐
- 基于老人画像的 TOP 候选路线排序
- 支持轮椅、拐杖、慢行等画像的硬约束和差异化权重
- H5 推荐模式和老人模式切换
- 老人模式大字提示、大按钮、模拟导航和模拟求助
