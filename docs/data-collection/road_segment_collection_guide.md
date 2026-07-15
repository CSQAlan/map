# 路段数据采集模板说明

**用途：** 给队友现场采集重庆师范大学试点路段数据使用。  
**模板文件：** `docs/data-collection/road_segment_collection_template.csv`

## 1. 采集原则

采集时不要只记录“能不能走”，而要记录“为什么适合或不适合老人走”。

重点字段包括：坡度、台阶、路宽、坡道、扶手、路面平整度、安全性、无障碍程度、休息设施、树荫、照明、现场照片和备注。

## 2. 字段说明

| 字段 | 含义 | 填写规则 |
| --- | --- | --- |
| `segment_code` | 路段唯一编号 | 建议使用 `S_地点A_TO_地点B` 或 `S_SAMPLE_001` |
| `start_node_code` | 起点节点编号 | 与 `road_node.osm_node_ref` 对应 |
| `end_node_code` | 终点节点编号 | 与 `road_node.osm_node_ref` 对应 |
| `name` | 路段名称 | 用自然语言描述，如“三号门到主路口A” |
| `collector` | 采集人 | 采集队员姓名 |
| `collect_date` | 采集日期 | 格式 `YYYY-MM-DD` |
| `lon_start` / `lat_start` | 起点经纬度 | WGS84 坐标 |
| `lon_end` / `lat_end` | 终点经纬度 | WGS84 坐标 |
| `length_m` | 路段长度 | 单位米，可用地图测距或现场估算 |
| `slope_percent` | 坡度 | 百分比，无法精确时先估算 |
| `width_m` | 路宽 | 单位米，轮椅建议至少 1.2m |
| `surface_type` | 路面类型 | `ASPHALT`、`CONCRETE`、`BRICK`、`GRAVEL`、`GRASS`、`WOOD`、`TILE`、`COBBLESTONE` |
| `surface_level` | 路面平整度 | 1-5，5 最平整 |
| `safety_level` | 安全等级 | 1-5，5 最安全 |
| `barrier_free_level` | 无障碍等级 | 1-5，5 最适合无障碍通行 |
| `rest_facility_score` | 休息设施评分 | 1-5，5 表示休息点友好 |
| `lighting_level` | 照明等级 | 1-5，5 表示照明好 |
| `crossing_safety_level` | 过街安全等级 | 1-5，5 表示过街安全 |
| `wheelchair_accessible` | 是否轮椅可通行 | `true` 或 `false` |
| `has_handrail` | 是否有扶手 | `true` 或 `false` |
| `has_ramp` | 是否有坡道 | `true` 或 `false` |
| `shade_coverage_percent` | 树荫覆盖率 | 0-100 |
| `bench_count` | 座椅数量 | 路段附近可休息座椅数 |
| `step_count` | 台阶数量 | 没有台阶填 0 |
| `step_height_cm` | 台阶高度 | 单位厘米，没有台阶填 0 |
| `photo_urls` | 照片地址 | 先填 `[]`，后续可填本地/云端照片 URL |
| `remark` | 备注 | 记录特殊情况 |

## 3. 评分建议

### 路面平整度 `surface_level`

- 5：平整、防滑、轮椅友好
- 4：基本平整，少量裂缝
- 3：可通行但有明显不平
- 2：坑洼、碎石或明显破损
- 1：不建议老人通行

### 安全等级 `safety_level`

- 5：人车分离、视野好、无明显危险
- 4：基本安全
- 3：需注意车辆或人流
- 2：有明显安全隐患
- 1：高风险路段

### 无障碍等级 `barrier_free_level`

- 5：轮椅可稳定通行，有坡道或无台阶
- 4：轮椅基本可通行
- 3：拐杖老人可通行，轮椅需谨慎
- 2：有明显障碍
- 1：不适合行动不便老人

## 4. 画像影响

轮椅老人会直接排除或强烈避免：有台阶且没有坡道、路宽不足 1.2m、无障碍等级低于 4、`wheelchair_accessible=false`。

拐杖老人不会直接排除少量台阶，但台阶、陡坡、无扶手、路面不平会显著增加成本。

慢行老人会更偏好有座椅、树荫好、坡度低、路面平整、休息设施评分高的路段。

## 5. 现场采集建议

每条路段至少拍 2 张照片：起点向终点方向、终点向起点方向。

如果有台阶、坡道、扶手、破损路面，需要额外拍细节照片。

## 6. 后续导入流程

1. 队友按模板采集路段数据。
2. 通过 CSV 导入脚本校验字段。
3. 写入 `segment_collect_record`。
4. 管理员审核后更新 `road_segment`。
5. 路线推荐算法自动使用新数据。
