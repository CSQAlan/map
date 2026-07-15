# MSR 路线规划 MVP 设计

**日期：** 2026-07-14  
**项目：** 助老地图比赛版 MVP  
**子项目：** 三号门 / 校医院 / 食堂试点路线推荐

## 1. 目标

本设计覆盖助老地图的第一版路线规划能力。

目标是基于当前 PostGIS 中的试点路网数据，实现一个可以演示“适老路线推荐”的后端接口。

本轮完成后，系统应支持：

- 按 POI 名称选择起点和终点
- 按老人画像选择路线权重
- 从真实路网中枚举候选路线
- 返回最多 3 条真实候选路线
- 对每条路线给出距离、评分、路段列表和推荐理由

## 2. 范围

### 2.1 本轮范围

本轮只覆盖：

- 三号门
- 校医院
- 食堂
- 当前种子路网中的 8 个节点和 11 条路段

### 2.2 不在本轮范围内

本轮不做：

- 经纬度吸附到最近道路
- 全校级路线规划
- A* / Dijkstra / K 短路复杂实现
- 实时交通
- 动态避障
- 前端地图绘制

## 3. 接口设计

### 3.1 请求方式

新增接口：

`GET /api/routes/recommend`

请求参数：

- `start_name`
- `end_name`
- `mobility_type`

示例：

`/api/routes/recommend?start_name=重庆师范大学三号门&end_name=重庆师范大学食堂&mobility_type=ASSISTED`

### 3.2 mobility_type

第一版支持：

- `INDEPENDENT`
- `ASSISTED`
- `FAMILY_ASSISTED`

### 3.3 响应结构

接口返回最多 3 条路线。

每条路线包含：

- `rank`
- `route_score`
- `distance_m`
- `estimated_minutes`
- `segment_codes`
- `segment_names`
- `summary`

`summary` 用于比赛演示解释路线推荐原因。

## 4. 算法方案

### 4.1 选择方案

第一版采用：

**内存图计算 + 枚举简单路径 + MSR 成本排序**

原因：

- 当前试点路网很小
- 实现清晰
- 便于测试
- 便于答辩解释
- 后续可替换为更成熟的 TOP-K 路径算法

### 4.2 图构建

每次请求从数据库读取：

- 活跃 `road_node`
- 活跃 `road_segment`
- 起点 POI
- 终点 POI

用 `road_segment.start_node_id` 和 `road_segment.end_node_id` 构建有向图。

第一版按有向图处理，因为当前种子数据本身按导航方向组织。

### 4.3 起终点映射

第一版采用 POI 名称映射。

映射规则：

- 起点 POI 名称匹配 `poi_facility.name`
- 终点 POI 名称匹配 `poi_facility.name`
- 再通过名称约定映射到对应路网节点

当前约定：

- `重庆师范大学三号门` -> `N_GATE3`
- `重庆师范大学校医院` -> `N_CLINIC`
- `重庆师范大学食堂` -> `N_CANTEEN`

这条规则后续可以被 POI 与 node 的显式关系表替代。

### 4.4 路径枚举

使用深度优先搜索枚举简单路径。

约束：

- 不重复访问同一个节点
- 最大路径深度限制为 8 个路段
- 最多返回排序后的 3 条路线

这样可以避免循环路径，也足够覆盖当前试点。

## 5. MSR 成本函数

每条路段成本由以下字段计算：

- `length_m`
- `slope_percent`
- `surface_level`
- `safety_level`
- `barrier_free_level`
- `rest_facility_score`
- `step_count`

### 5.1 风险映射

映射规则：

- `distance_cost = length_m / 100`
- `slope_risk = slope_percent`
- `surface_risk = 6 - surface_level`
- `safety_risk = 6 - safety_level`
- `barrier_free_risk = 6 - barrier_free_level`
- `rest_risk = 6 - rest_facility_score`
- `step_risk = step_count * 2`

### 5.2 画像权重

`INDEPENDENT`：

- 距离更重要
- 平坦和安全也纳入考虑

权重：

- `distance`: 1.2
- `slope`: 1.0
- `surface`: 0.8
- `safety`: 0.9
- `barrier_free`: 0.5
- `rest`: 0.4
- `step`: 0.8

`ASSISTED`：

- 平整、安全、无障碍更重要

权重：

- `distance`: 0.8
- `slope`: 1.4
- `surface`: 1.3
- `safety`: 1.3
- `barrier_free`: 1.2
- `rest`: 0.9
- `step`: 1.5

`FAMILY_ASSISTED`：

- 安全、可解释、休息点更重要

权重：

- `distance`: 0.9
- `slope`: 1.1
- `surface`: 1.0
- `safety`: 1.5
- `barrier_free`: 1.0
- `rest`: 1.1
- `step`: 1.2

### 5.3 路线总分

路线总分为所有路段成本之和。

分数越低，路线越推荐。

## 6. 推荐理由生成

第一版采用规则生成 `summary`。

规则：

- 如果路线平均坡度较低，说明“坡度较缓”
- 如果平整度平均值较高，说明“路面较平整”
- 如果安全性平均值较高，说明“安全性较好”
- 如果休息设施得分较高，说明“沿途休息点更友好”
- 如果存在台阶，说明“存在台阶，需要注意”

这部分用于比赛演示，不作为复杂自然语言生成。

## 7. 错误处理

接口需要处理：

- 起点 POI 不存在：返回 404
- 终点 POI 不存在：返回 404
- `mobility_type` 不支持：返回 422
- 起终点相同：返回 400
- 无可达路径：返回 404

## 8. 测试标准

本轮至少需要测试：

- 成本函数对低风险路段给出更低成本
- 不同画像会产生不同路线评分
- 路径枚举能找到从三号门到食堂的多条候选路线
- 推荐接口返回最多 3 条路线
- 起点不存在时返回 404

## 9. 交付标准

本轮完成定义为：

- 后端存在路线推荐服务
- 后端存在路线推荐 API
- 接口能基于当前数据库路网返回真实候选路线
- 结果能体现不同画像权重
- 测试通过

## 10. 后续扩展

后续可以继续扩展：

- 改为 `POI id` 输入
- 加入经纬度吸附
- 换成 Dijkstra / A* / K 短路
- 将路线结果写入 `route_plan_record`
- 前端展示路线地图

