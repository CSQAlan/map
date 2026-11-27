# 出发前看首段实景

已公布设计、用户授权直接实施，仅在当前隔离副本操作；不提交、不访问原媒体、不调用外部服务或其他 agents。

## 实施计划

只读来源由 `useRoutePlanner` 导出：当前结果页的普通老人/游客、已完成且回显一致的命名起终点查询、唯一有效起终点、同一画像/策略/会话、原候选对象与身份内容一致，无 GPS 起点和绕行。复用 `namedRouteEvidence`、`routeIdentity`，另记录查询时本地版本防止旧响应跨会话授权。

小组件复用 `buildNavigationPhotoCue(..., 0)`，只展示第一步骤第一张照片；缺失或无效不取下一段、不从地图选择。默认无图片节点，显式打开才请求一张精确 URL。登记说明和加载失败均如实显示；图片回调绑定每次打开的实例。换路线、证据、会话、出行条件、离页或开始行程时关闭。原图库改为主动展开，避免初始缩略图请求；在途照片不变。

- [x] 先添加来源、首段匹配和组件生命周期定向测试，记录预期失败。
- [x] 实现只读来源、首段小组件和 App/路线页传参。
- [x] 运行 `node --test --test-concurrency=4` 和 Vite build。
- [x] 用本地 Playwright 拦截全部 API、图片及外部请求，验证真实 App、无副作用、键盘和 320px/150%。
- [x] 逐项复核改动，补录制步骤、实测结果、未测范围、文件清单。

## 最终行为

入口在路线候选下方，作用于当前所选普通候选。地图选中路段不会决定首段；`segments` 明细的数组顺序也不会决定首段。只认 `segment_codes[0]`，由现有安全匹配器核对段码唯一、路线行与登记名称一致、照片 ID/说明/风险标签有效、缩略图和显示图路径精确匹配、HTTP(S) 服务基址可信。任何路线登记歧义均保守拒绝。

默认没有图片节点、缩略图预取或照片请求；点击“出发前看首段实景”才挂载至多一张显示图。没有“下一张”或“下一段”入口。首段缺图但下一段有图仍显示缺图；坏资料和未配置服务地址显示核对失败原因；HTTP/离线失败保留登记说明并显示加载失败，不重试、不借用第二张或其他路段。可关闭后主动重新打开同一张。

固定文字为“登记照片，只用于认路，不代表现状或当前位置。”另说明照片朝向、出发方向及入口未确认。图片仅是认路资料，不推断当前方位、入口、拍摄新旧或通行状况。

入口仅在当前结果页、老人或游客、当前查询完成、命名起终点回显/画像/策略一致、原始候选身份及内容仍一致、唯一地点选项仍存在时可用。GPS 起点、`start_context`、绕行/暂停绕行、克隆或未查询候选、跨账号/会话旧结果均不提供首段预览。查询时保存本地撤销版本，换账号或再次进入游客模式后，迟到的旧查询也不能重新授权。

切路线、路线内容、地图证据或试点范围、出行条件、账号/会话、服务基址变化、地图重新加载、离页和开始行程会关闭。每次打开独立持有 load/error 回调和版本；旧回调既不能打开面板，也不能把新图标为失败。开始行程只复用原按钮事件；照片组件没有导航、GPS、共享、存储或地图操作。

现有路线图库收进“查看其他登记路段照片”，主动展开后仍使用原组件。这样初始路线页不加载旧图库缩略图；该图库与首段预览各自独立。在途“看实景认路”组件及匹配逻辑均未修改。路线排序、适老指标、“可中途休息”、到达回执、返程和绕行业务未修改。

## 真实登记索引核对

只读使用副本中的 `backend/app/db/seed_data/core_segments.json` 与 `photo_manifest.json`，没有打开或复制任何原始照片文件。`S_SY_GATE_TO_MAIN`（入口到内部主路中心）的首个照片引用 `IMG_9499.JPG` 在清单中唯一对应 `SY_IMG_9499`，登记说明为“师大苑内部主路入口段”；由匹配器得到 `/media/evidence/display/SY_IMG_9499.webp`。此项在单测中验证，并不证明照片内容、现场现状或用户位置。浏览器图片全部由合成像素响应替代。

## 可录操作（约 45 秒）

在 `frontend` 使用已有依赖和本机 Chrome：

```powershell
node scripts/check-predeparture-first-leg-photo.mjs --demo
```

命令启动临时本地 Vite 和一个 320px、150% 根字体的演示浏览器，所有 API/媒体均被本地 mock 接管，关闭演示窗口即退出。无需后端、账号、地图密钥或环境配置。图框为合成像素，不可介绍成真实现场照片。

1. 0–8 秒：展示两条合成候选和当前所选路线，指出尚未开始导航，页面没有加载照片。
2. 8–18 秒：点击“出发前看首段实景”，展示首段名称、唯一图框及登记说明；读出“不代表现状或当前位置”。
3. 18–26 秒：关闭，选第二条路线，展示预览已关闭；重新打开只显示第二条候选的首段。
4. 26–34 秒：按 Escape 关闭，焦点返回原入口；再次打开并滚动查看 320px/150% 大字下的说明。
5. 34–45 秒：点击“开始导航”，出发前预览消失；说明在途“看实景认路”仍是独立原功能。

缺图演示另运行 `node scripts/check-predeparture-first-leg-photo.mjs --demo --missing`：第一条路线首段无照片、下一段有照片，打开后展示缺图文字和“不换用后续路段照片”，不出现替代图。可先展示这一段再回到正常演示。

## 实际验证（2026-11-27）

在 `frontend` 执行：

```powershell
node --test tests/predeparture-photo-source.test.js tests/predeparture-first-leg-photo.test.js
node --test --test-concurrency=4
npm run build
node scripts/check-predeparture-first-leg-photo.mjs --no-artifacts
node scripts/check-predeparture-first-leg-photo.mjs --demo-smoke
node scripts/check-navigation-photo-cue.mjs --no-artifacts
node scripts/check-navigation-arrival.mjs --no-artifacts
node scripts/check-return-journey.mjs --no-artifacts
```

结果：新增定向测试 41/41；全部单测 730/730，失败和跳过均为 0；Vite build 成功，154 modules。新增浏览器检查 27 个场景通过，覆盖老人/游客、初始零媒体、单张精确 URL、首段缺图/坏图/重复登记、HTTP/离线失败、无重试、切路线时迟到的图片响应、换会话时迟到的查询响应、起终点/画像/策略/证据/账号/会话变化、离页/刷新/开始行程、普通与暂停绕行排除、原图库主动展开及原在途照片和回执。

浏览器对比预览前后路线、选择索引、适老和休息相关状态、出行条件、绕行、存储以及 GPS/语音/唤醒调用，均未因预览变化；预览没有新增 API 或家属/导航写请求。原在途实景 SDK mock/示意图检查通过；到达回执 11 场景和返程 16 场景通过。既有完整单测还覆盖路线排序、适老比较、休息预览、步行预算、排除和绕行约束。

键盘实测 Enter 打开、关闭按钮聚焦、Escape/关闭返回入口，原图库 summary 可用 Enter 展开/收起。320px、150% 根字体下页面和面板无横向溢出，预览按钮至少 48×48px，说明字体至少 24px；照片说明能滚动至固定底栏上方，中心点未被遮挡。实际生成并人工查看了合成场景截图，交付前移除截图、构建产物和临时日志。根字体缩放不等同于全部系统字体或浏览器缩放机制。

红绿记录：先运行新增 40 项测试，因组件/来源 computed 尚不存在全部按预期失败；实现后新增一项真实索引只读核对。组件测试检出 Vue 缓存图片事件会读取新预览的问题，改为直接绑定每次请求的回调后通过；绕行浏览器用例最初因合成明细倒序违反现有绕行 DTO 约束而失败，修正测试候选顺序后通过，未改绕行业务。

内置浏览器初始化失败，实际使用现有 Playwright/Chrome 运行本地检查。没有安装依赖、调用外部服务、改环境文件/系统设置、使用其他 agents、访问原项目或媒体、stage/commit/push。副本没有可用 Git 元数据，本轮按文件内容逐项自审。

未测：物理手机、Android WebView、系统读屏、真实 GPS/地图 SDK、真实后端/家属服务以及实际照片像素；可见的带窗口录制操作未替代真机验证。

## 交付文件清单

- 修改 `frontend/src/composables/useRoutePlanner.js`：只读来源 computed、本地预览撤销版本及查询版本记录。
- 修改 `frontend/src/App.vue`：传递结果页/身份/会话上下文和预览来源。
- 修改 `frontend/src/pages/RouteOptionsPage.vue`：接入首段组件、开始行程关闭、原图库显式展开。
- 新增 `frontend/src/components/PredepartureFirstLegPhoto.vue`：首段单图、真话降级、版本隔离和键盘交互。
- 新增 `frontend/tests/predeparture-photo-source.test.js`。
- 新增 `frontend/tests/predeparture-first-leg-photo.test.js`。
- 新增 `frontend/scripts/check-predeparture-first-leg-photo.mjs`。
- 新增 `docs/predeparture-first-leg-photo-demo.md`（本文件）。

没有修改后端、照片索引、原媒体、在途照片组件、依赖或环境配置。
