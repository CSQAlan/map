# 助老地图后端

## 环境

项目使用当前工作区下的 Conda 环境：

```powershell
conda activate F:\items\map\.conda\elder-map-py311
```

## 启动

在项目根目录执行：

```powershell
cd F:\items\map\backend
$env:PYTHONPATH = "F:\items\map\backend"
python -m uvicorn app.main:app --reload
```

服务默认启动在：

- `http://127.0.0.1:8000`
- 文档地址：`http://127.0.0.1:8000/docs`

## 初始化地图与种子数据

```powershell
cd F:\items\map\backend
$env:PYTHONPATH = "F:\items\map\backend"
python -m app.scripts.init_map_data
```

预期输出类似：

```text
{'areas': 1, 'nodes': 8, 'pois': 3, 'segments': 11, 'survey_sites': 7, 'survey_records': 67}
```

该命令也会幂等初始化独立踩点表；数据库中管理员已补充的位置会保留，不会进入正式路线图。

## 启动 PostGIS 数据库

在项目根目录执行：

```powershell
cd F:\items\map
docker compose -f .\docker-compose.postgis.yml up -d
```

默认数据库连接：

- Host: `127.0.0.1`
- Port: `5432`
- Database: `elder_map`
- Username: `postgres`
- Password: `postgres`

## 验证

```powershell
cd F:\items\map\backend
$env:PYTHONPATH = "F:\items\map\backend"
python -m pytest tests -q
```

## 路线推荐接口

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/routes/recommend?start_name=重庆师范大学三号门&end_name=重庆师范大学食堂&mobility_type=ASSISTED"
```

## 当前内容

- FastAPI 应用入口
- 配置管理
- 数据库引擎与会话
- 健康检查接口
- SQLAlchemy 基础模型
- MVP 核心表 ORM 模型骨架
- 地图与种子数据初始化工具
- 只读地图数据查询接口
- MSR 路线推荐接口
- 大学城待核查踩点记录 API 与独立 WebP 媒体
- HMAC 管理员会话保护的踩点位置更新接口

生产环境必须设置足够随机的 `ADMIN_TOKEN_SECRET`；开发环境仅使用代码内的开发专用默认密钥。不要把开发密钥用于公开部署。

## 下一步

- 接入 PostgreSQL / PostGIS 实例并实际落库
- 编写 Alembic 迁移
- 加入 POI、路线、画像等业务接口
