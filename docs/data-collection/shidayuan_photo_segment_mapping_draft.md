# 师大苑照片-路段映射初稿

适用阶段：师大苑试点 A 方案，也就是先用现有踩点照片和地图截图整理第一版人工路网，后续再逐步接入高德地图底图/API。

目标：把 `IMG_9536等56项文件` 中的现场照片，转成可以进入 `road_node`、`poi_facility`、`road_segment` 的候选数据。本文不是最终入库数据，而是入库前的人工审核草稿。

## 1. 当前结论

师大苑第一版不建议直接“导入地图截图”。地图截图只能帮助我们确认边界、楼栋分布和外部道路位置，真正能影响路线算法的，是现场照片里能看到的路面、台阶、坡道、扶手、车辆混行、树荫、座椅等适老字段。

第一版推荐试点范围：

- 小区主入口/大学城西路一侧
- 小区内部车行主路
- 荷塘/水景休息区
- 林下步道和亭廊休息区
- 外部商业街/人行道入口衔接点

第一版路线演示重点：

- 轮椅老人：优先小区车行主路和宽路面，强避开台阶、汀步、木平台高差。
- 拐杖老人：允许少量低风险台阶，但对连续台阶、破损路面、窄路加高惩罚。
- 慢行老人：偏好树荫、座椅、休息节点，但不能牺牲明显安全风险。

## 2. 与高德地图对齐的数据库策略

我们可以从一开始为高德接入留接口，但不建议把数据库锁死成“只存高德坐标/高德 ID”。原因是当前资料里有百度地图截图、手机照片、未来可能有 GPS 和高德 API，坐标系与来源并不统一。

推荐策略：

- `geom` 继续作为系统内部标准几何字段，统一存 `EPSG:4326` 经纬度。
- 高德坐标、百度截图、人工采集 GPS 都作为来源证据保存，不直接覆盖内部标准几何。
- 后续接入高德时，在导入层做坐标转换、来源记录和置信度记录。

建议后续给节点、POI、路段增加或预留这些字段：

| 字段 | 建议类型 | 用途 |
| --- | --- | --- |
| `source_provider` | text | 数据来源，例如 `manual_photo`、`amap`、`baidu_screenshot`、`mobile_gps` |
| `source_coord_type` | text | 坐标来源类型，例如 `wgs84`、`gcj02`、`bd09`、`screen_reference` |
| `source_ref` | text | 高德 POI ID、截图文件名、采集记录 ID 等 |
| `evidence_photo_refs` | jsonb | 支撑该路段字段的照片文件名列表 |
| `data_confidence` | integer | 1-5，表示位置和字段可信度 |
| `last_verified_at` | timestamptz | 最近一次现场确认时间 |
| `verified_by` | text | 审核人或采集小组 |

## 3. 第一版 POI 与节点

这些名称先用于演示和数据采集，不要求一次性精确到楼栋门牌。后续现场确认后，可以再拆细。

| 编号 | 名称 | 类型 | 说明 | 置信度 |
| --- | --- | --- | --- | --- |
| `SY_GATE_WEST` | 师大苑大学城西路入口 | entrance | 外部商业街/大学城西路进入小区的位置 | 中 |
| `SY_MAIN_CENTER` | 师大苑内部主路中心点 | waypoint | 内部车行主路和楼栋通行的中心节点 | 中 |
| `SY_BUILDING_GROUP_A` | 师大苑楼栋组团 A | building_group | 地图截图中 48-51 栋附近可作为第一版楼栋组团 | 中 |
| `SY_BUILDING_GROUP_B` | 师大苑楼栋组团 B | building_group | 地图截图中 54-56 栋附近可作为第一版楼栋组团 | 中 |
| `SY_LOTUS_REST` | 荷塘水景休息区 | rest_area | 有水景、座椅、树荫，是慢行老人友好节点 | 高 |
| `SY_GARDEN_PATH` | 林下休闲步道 | rest_area | 林下步道、亭廊、汀步和台阶集中区域 | 高 |
| `SY_COMMERCIAL_SIDEWALK` | 外部商业街人行道 | service_access | 小区外部生活服务方向，可接入餐饮/商铺 | 中 |

## 4. 第一版候选路段

字段建议采用保守值，宁可先把风险标高一点，也不要为了路线好看而放宽轮椅通行判断。

| 路段编号 | 路段名称 | 主要照片证据 | 推荐用途 | 初步适老判断 |
| --- | --- | --- | --- | --- |
| `SY_MAIN_WEST_TO_CENTER` | 西侧入口至内部主路中心 | `IMG_9499.JPG`、`IMG_9500.JPG`、`IMG_9502.JPG`、`IMG_9503.JPG`、`IMG_9540.JPG`、`IMG_9542.JPG`、`IMG_9544.JPG` | 轮椅/拐杖主路径 | 路面宽、树荫好，但车辆、电动车、停车混行，安全分不宜过高 |
| `SY_MAIN_TO_LOTUS` | 内部主路至荷塘休息区 | `IMG_9550.JPG`、`IMG_9551.JPG` | 慢行休息路线 | 环境舒适、座椅多，靠车行路一侧有路缘和台阶断点 |
| `SY_LOTUS_PLATFORM_EDGE` | 荷塘平台边缘连接段 | `IMG_9551.JPG`、`IMG_9553.JPG` | 风险提示段 | 有平台高差、路缘石或破损边界，轮椅不应默认通过 |
| `SY_GARDEN_COMFORT_PATH` | 林下舒适步道 | `IMG_9509.JPG`、`IMG_9517.JPG`、`IMG_9518.JPG`、`IMG_9520.JPG`、`IMG_9537.JPG` | 慢行优先候选 | 树荫和环境好，但路径较窄，局部有边界高差 |
| `SY_GARDEN_STEPPING_SHORTCUT` | 林下汀步/石板捷径 | `IMG_9508.JPG` | 反例路线 | 适合作为“最短但不适老”的演示，轮椅不可通行 |
| `SY_CRACKED_PAVEMENT_RISK` | 路面裂缝风险点 | `IMG_9511.JPG` | 风险提示段 | 路面裂缝明显，对拐杖和轮椅都需要高惩罚 |
| `SY_STEP_ENTRANCE_A` | 两级台阶入口 | `IMG_9513.JPG` | 阻断点 | 约 2 级台阶，无明显坡道/扶手，轮椅不可通行 |
| `SY_WOOD_DECK_REST` | 木平台休息区 | `IMG_9515.JPG`、`IMG_9522.JPG` | 慢行休息节点 | 有座椅/景观，但木板缝隙、边缘高差要谨慎 |
| `SY_POND_BRIDGE` | 水景桥/桥面连接 | `IMG_9524.JPG`、`IMG_9529.JPG`、`IMG_9533.JPG`、`IMG_9546.JPG` | 景观候选路线 | 桥面较宽且有栏杆，但连接处可能有高差，需复核轮椅是否可达 |
| `SY_POND_STAIR_PATH` | 水景台阶步道 | `IMG_9523.JPG`、`IMG_9526.JPG`、`IMG_9528.JPG`、`IMG_9536.JPG`、`IMG_9539.JPG` | 风险/阻断路线 | 多处台阶，无明显坡道，轮椅不可通行，拐杖也应高惩罚 |
| `SY_PAVILION_REST` | 亭廊休息区 | `IMG_9531.JPG`、`IMG_9536.JPG` | 休息节点 | 可作为休息点，但入口高差需标注 |
| `SY_COMMERCIAL_SIDEWALK_LINK` | 小区外部商业街人行道衔接 | `IMG_9555.JPG` | 外部服务连接 | 人行道宽，但有围栏、锥桶、车流，过街/入口安全需要单独审核 |

## 5. 候选字段初值

下面是给第一版 seed 数据用的粗评分，不是最终现场审核值。

| 路段编号 | surface_type | surface_level | safety_level | barrier_free_level | rest_facility_score | wheelchair_accessible | step_count | has_ramp | has_handrail | shade_coverage_percent | bench_count |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SY_MAIN_WEST_TO_CENTER` | asphalt | 4 | 3 | 4 | 3 | true | 0 | false | false | 80 | 0 |
| `SY_MAIN_TO_LOTUS` | asphalt/stone | 4 | 3 | 3 | 5 | false | 1 | false | false | 85 | 3 |
| `SY_LOTUS_PLATFORM_EDGE` | stone | 3 | 3 | 2 | 5 | false | 1 | false | false | 80 | 2 |
| `SY_GARDEN_COMFORT_PATH` | stone | 3 | 4 | 3 | 4 | false | 0 | false | false | 90 | 0 |
| `SY_GARDEN_STEPPING_SHORTCUT` | stepping_stone | 2 | 3 | 1 | 4 | false | 0 | false | false | 90 | 0 |
| `SY_CRACKED_PAVEMENT_RISK` | stone | 2 | 3 | 2 | 2 | false | 0 | false | false | 40 | 0 |
| `SY_STEP_ENTRANCE_A` | stone | 3 | 3 | 1 | 2 | false | 2 | false | false | 60 | 0 |
| `SY_WOOD_DECK_REST` | wood | 3 | 3 | 2 | 5 | false | 1 | false | true | 85 | 2 |
| `SY_POND_BRIDGE` | stone/bridge | 4 | 4 | 3 | 4 | false | 1 | false | true | 80 | 0 |
| `SY_POND_STAIR_PATH` | stone | 3 | 3 | 1 | 4 | false | 3 | false | false | 85 | 1 |
| `SY_PAVILION_REST` | stone | 3 | 4 | 2 | 5 | false | 1 | false | false | 90 | 2 |
| `SY_COMMERCIAL_SIDEWALK_LINK` | paving | 4 | 2 | 3 | 2 | true | 0 | true | false | 40 | 0 |

## 6. 照片证据清单

| 文件 | 类型 | 可以支撑的字段 | 建议关联 |
| --- | --- | --- | --- |
| `IMG_9501.PNG` | 地图截图 | 师大苑周边边界、楼栋位置参考 | 节点/边界参考，不直接入库 |
| `IMG_9504.PNG` | 地图截图 | 周边商业与入口参考 | 节点/边界参考，不直接入库 |
| `IMG_9510.PNG` | 地图截图 | 师大苑 48-56 栋附近分布 | POI/楼栋组团参考 |
| `IMG_9512.PNG` | 地图截图 | 师大苑与外部道路关系 | POI/边界参考 |
| `IMG_9535.PNG` | 地图截图 | 师大苑内部与大学城西路关系 | POI/边界参考 |
| `IMG_9499.JPG` | 主路照片 | 宽度、树荫、车行混行、路缘 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9500.JPG` | 主路照片 | 内部路口、树荫、停车影响 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9502.JPG` | 主路照片 | 车行路、路缘、旁侧步道 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9503.JPG` | 主路照片 | 内部交叉/转弯、视线和车辆风险 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9505.JPG` | 楼栋入口附近 | 楼栋连接、可能有高差 | `SY_MAIN_TO_LOTUS` 或楼栋支路，需现场确认 |
| `IMG_9508.JPG` | 汀步捷径 | 不连续石板、草地边界、轮椅不可通行 | `SY_GARDEN_STEPPING_SHORTCUT` |
| `IMG_9509.JPG` | 林下步道 | 树荫、步道宽度、边界 | `SY_GARDEN_COMFORT_PATH` |
| `IMG_9511.JPG` | 路面细节 | 裂缝/缝隙风险 | `SY_CRACKED_PAVEMENT_RISK` |
| `IMG_9513.JPG` | 台阶细节 | 约 2 级台阶、无坡道 | `SY_STEP_ENTRANCE_A` |
| `IMG_9515.JPG` | 木平台 | 座椅、木板缝、边缘高差 | `SY_WOOD_DECK_REST` |
| `IMG_9517.JPG` | 林下窄步道 | 窄路、树荫、边界 | `SY_GARDEN_COMFORT_PATH` |
| `IMG_9518.JPG` | 林下窄步道 | 路宽、树荫、边界 | `SY_GARDEN_COMFORT_PATH` |
| `IMG_9520.JPG` | 景观步道 | 绿地路径、舒适度、非轮椅友好 | `SY_GARDEN_COMFORT_PATH` |
| `IMG_9522.JPG` | 水景平台 | 座椅/休息点、木平台 | `SY_WOOD_DECK_REST` |
| `IMG_9523.JPG` | 台阶步道 | 台阶阻断、石板路径 | `SY_POND_STAIR_PATH` |
| `IMG_9524.JPG` | 水景桥 | 桥面、栏杆、连接高差 | `SY_POND_BRIDGE` |
| `IMG_9526.JPG` | 连续台阶 | 台阶阻断，无明显坡道 | `SY_POND_STAIR_PATH` |
| `IMG_9528.JPG` | 台阶与座椅 | 台阶阻断、休息点 | `SY_POND_STAIR_PATH` |
| `IMG_9529.JPG` | 桥/平台入口 | 台阶或边缘高差 | `SY_POND_BRIDGE` |
| `IMG_9531.JPG` | 亭廊 | 休息点、入口高差 | `SY_PAVILION_REST` |
| `IMG_9532.JPG` | 铺装边界 | 路面边界/局部高差 | `SY_POND_BRIDGE` 或 `SY_PAVILION_REST`，需现场确认 |
| `IMG_9533.JPG` | 桥前路径 | 桥前连接、边缘高差 | `SY_POND_BRIDGE` |
| `IMG_9534.JPG` | 铺装边界 | 路面平整度、边缘 | `SY_POND_BRIDGE` 或 `SY_PAVILION_REST`，需现场确认 |
| `IMG_9536.JPG` | 亭廊入口 | 低台阶、平台边界 | `SY_PAVILION_REST` |
| `IMG_9537.JPG` | 林下分叉步道 | 步道分叉、树荫、局部高差 | `SY_GARDEN_COMFORT_PATH` |
| `IMG_9539.JPG` | 台阶步道 | 多级台阶、林下连接 | `SY_POND_STAIR_PATH` |
| `IMG_9540.JPG` | 内部主路 | 车辆/电动车混行、停车、树荫 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9542.JPG` | 内部主路与桥边 | 路缘、车行路、桥边平台 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9544.JPG` | 内部主路 | 停车、电动车、楼栋侧路 | `SY_MAIN_WEST_TO_CENTER` |
| `IMG_9546.JPG` | 桥面 | 宽桥面、栏杆、坡度/高差待测 | `SY_POND_BRIDGE` |
| `IMG_9548.JPG` | 路缘座椅入口 | 休息椅、路缘石断点 | `SY_MAIN_TO_LOTUS` |
| `IMG_9550.JPG` | 荷塘主路 | 荷塘、车行主路、树荫 | `SY_MAIN_TO_LOTUS` |
| `IMG_9551.JPG` | 荷塘平台 | 座椅、平台高差、路缘 | `SY_LOTUS_PLATFORM_EDGE` |
| `IMG_9553.JPG` | 外部入口路缘 | 破损路缘、坡口/高差 | `SY_COMMERCIAL_SIDEWALK_LINK` |
| `IMG_9555.JPG` | 外部商业街人行道 | 人行道宽度、围栏、锥桶、车流 | `SY_COMMERCIAL_SIDEWALK_LINK` |

未逐张作为现场证据使用的 PNG：`IMG_9507.PNG`、`IMG_9514.PNG`、`IMG_9516.PNG`、`IMG_9519.PNG`、`IMG_9521.PNG`、`IMG_9525.PNG`、`IMG_9527.PNG`、`IMG_9530.PNG`、`IMG_9538.PNG`、`IMG_9541.PNG`、`IMG_9543.PNG`、`IMG_9545.PNG`、`IMG_9547.PNG`、`IMG_9549.PNG`、`IMG_9552.PNG`、`IMG_9554.PNG`。这些建议作为地图截图参考，后续如果要精确定位节点，再统一读取。

## 7. 下一步入库计划

1. 由熟悉现场的队友确认每个路段编号是否对应真实位置，尤其是 `SY_MAIN_TO_LOTUS`、`SY_POND_BRIDGE`、`SY_PAVILION_REST` 三类容易混淆的位置。
2. 确认师大苑第一版演示的起终点，建议先用“入口 -> 荷塘休息区”和“楼栋组团 A -> 外部商业街”两条路线。
3. 根据本文生成 `core_nodes.json`、`core_pois.json`、`core_segments.json` 的师大苑版本。
4. 给数据库迁移预留来源字段和照片证据字段，让后续高德 API、手机 GPS、人工照片可以统一进入审核流。
5. 把后端当前写死的重庆师范大学校内起终点逻辑，改成读取 POI code 或 POI ID。
6. 前端把“三号门/校医院/食堂”替换为师大苑试点 POI，并保留画像切换、TOP 路线切换和采集模式。

## 8. 当前最难的问题

最难的不是写算法，而是把“照片里的真实障碍”准确落到“地图上的哪一小段路”。如果路段位置错了，算法再精细也会推荐错路。因此第一版必须先做人工审核，不要急着自动化。

另外，高德地图通常能给外部道路和 POI，但小区内部园路、亭廊、荷塘边台阶、汀步捷径不一定有完整数据。我们的项目价值正好在这里：用高德做底图，用人工采集补足适老细节。
