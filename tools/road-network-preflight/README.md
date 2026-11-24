# 新路段接入预检（独立、只读）

任何结果都不等于审定、发布或已纳入导航，不判断无障碍或现场安全。

本工具只读取 seed JSON 和明确指定的候选 JSON，输出报告到标准输出。不导入应用、seed loader、配置或数据库，不建表、不联网、不读取照片生成线、不写种子或导航。仅用标准库和本机已安装的 Shapely。旧校区停用路网不作为现役锚点，其保留边 ID 也不可重用。

## 本机命令（仓库根目录 PowerShell）

```powershell
# 真实仓库文件的只读基线核对；没有提供新线时不推断候选
& .\.conda\elder-map-py311\python.exe -B .\tools\road-network-preflight\preflight.py
# 用你独立准备的实测候选文件检查，不写回文件
& .\.conda\elder-map-py311\python.exe -B .\tools\road-network-preflight\preflight.py --candidate C:\field-survey\measured-batch.json
# 合成测试，不启动任何服务
& .\.conda\elder-map-py311\python.exe -B -m unittest discover -s tools/road-network-preflight -p test_preflight.py -v
git diff --check
```

退出码：0=基线读取成功，或所有候选仅可提交人工复核；1=存在缺字段、不连通或区外扩区项；2=无效数据、输入错误或缺实测线。0 绝不是发布许可。

## 真实基线与资料边界

读取 `backend/app/db/seed_data/core_nodes.json` 的 `node_code/lon/lat`、`core_segments.json` 的 `segment_code/start_node_code/end_node_code`、`core_pois.json`，以及 `pilot_areas.json` 中 ACTIVE 的 SHIDAYUAN `boundary_wkt`。现有 loader 将其作为 SRID 4326；本工具不执行 loader，也不采用其默认路宽/台阶值或端点生成直线机制。读取 loader 中的旧校区 ID 字面量仅为保留 ID，不执行它。

基线为 12 节点、17 路段、6 POI；另 7 处 67 条待审照片记录中 21 有点坐标，46 缺坐标。照片记录不是轨迹，不具备可直接接入的实测新增路段；不把照片点、截图标记或推断直线当实测几何。只读核对会输出文件 SHA256，以便比对。

## 候选格式与最少字段

选择简洁 JSON 格式，不接收任意 GeoJSON FeatureCollection。顶层要求 `format_version:1`、`area_code:"SHIDAYUAN"`、`crs:"EPSG:4326"`、`nodes:[]`、`segments:[]`。坐标为 WGS84 **经度在前、纬度在后**，每点恰好两个有限数。不自动转换 GCJ02；不能因给错误坐标换标签就当作 WGS84。

- 新节点：`node_code`、实测 `lon/lat`、`source`。现役基线节点直接引用 ID，不能在新节点表覆盖定义。
- 路段：唯一 `segment_code`、`start_node_code`、`end_node_code`、`geometry:{type:"LineString",coordinates:[...]}`、`source`。几何必须由实际沿线测量/轨迹取得，工具不会生成或吸附；两点线只有确实测得该直线且来源可核查才可能提交人工复核。
- `source` 必须包含 `method`（`field_trace` 或 `measured_survey`）、可追查记录引用 `ref`、`observed_on`（YYYY-MM-DD）。新节点和每条线各自提供，工具只能检查声明，真实性仍需人核验。不要填写真实账户、秘密、定位人员姓名等无关资料。
- 登记指标：`width_m`（最窄路宽，>0）、`slope_percent`（最大坡度，>=0）、`step_count`（非负整数）、`surface_type`（实测路面描述）、`has_ramp`、`has_handrail`（明确布尔值）。有台阶时补 `step_height_cm`（>0）。缺值进入待补数据，不补零、不推断 `wheelchair_accessible`。

**以下只是合成格式示例，不是实测资料，禁止放入 seed 或数据库**（完整可执行合成样例仅在测试中）：

```json
{
  "format_version": 1,
  "area_code": "SHIDAYUAN",
  "crs": "EPSG:4326",
  "nodes": [],
  "segments": []
}
```

空模板不会通过候选预检。先取得真实实测线与两端节点信息，才有可检查候选；本目录不附伪装为实测的本地路线。

## 检查与分类

1. 检查坐标、来源、端点引用、同节点环、非零有效且无自交线、ID 冲突。首尾必须按声明方向贴合节点，局部米制近似距离容差为 5 米；不修改输入。空间距离只是质量门槛，不是通行判定。
2. 用试点中心局部等距近似进行米级质量检查，合理邻域为距边界 2000 米以内。超出则判无效并提示核对坐标/另立试点；仍完整保留候选，不裁剪、不丢弃合法经纬度。附近区外线单列 `outside_boundary` 人工扩区复核，绝不算就绪。检查整条线和声明的两端节点是否均被边界覆盖，而非只看线端点；5 米贴合容差不能豁免区外节点，其关联边也不能作为区内连接桥。
3. 按明确共享节点 ID 建无向**拓扑**分量；批次边可经其他有效区内批次边接回现役图，顺序无关。交叉、同坐标异 ID、距离靠近不自动连通。无效边和区外边不作为连接桥；指标待补边可参与纯拓扑检查，但不能因此发布任何线路。
4. 输出互斥主分类：`reviewable` 可提交人工复核；`missing_fields` 缺登记字段；`disconnected` 不连通；`outside_boundary` 区外扩区复核；`invalid` 无效。每项保留输入及缺字段列表，分类优先级为无效→区外→不连通→缺字段→人工复核。多问题可同时存在，不连通/区外项仍显示缺字段；无关节点问题也会导致全批退出 2。

### 反方向、重复边与旧校区

线坐标倒序时必须同步交换起终节点，否则端点不贴合；工具不自动反向。相同 `segment_code` 与现役/保留 ID 冲突或批次重复时全部拒绝，不覆盖、不最后一条胜出。不同 ID 但相同无序两端（包括反向）也拒绝自动就绪；确有独立平行道路，需人工拓扑消歧及后续独立设计，而不是靠换 ID 绕过去。拓扑检查不表示道路双向可通行，也不验证方向通行规则。

工具不会读取/启用旧校区 SQL 路网。只有现役 core 文件中的有效路段两端作为锚点，孤立节点本身不算接回现役图。

## 实施计划和限制

本目录内实现读取/验证→合成连通、断开、坐标/端点/重复/缺指标测试→真实文件只读盘点→差异检查。不涉及应用接线。后续至少需要真实来源可核查的 WGS84 完整线、两端实测/基线节点、上述登记指标，人工复核后再另行设计审批和正式入库。来源造假、测量精度、路权、门禁、动态障碍、坡道细节不由本工具自动证明。Shapely 几何有效也不证明实测可信或轮椅可通行。
