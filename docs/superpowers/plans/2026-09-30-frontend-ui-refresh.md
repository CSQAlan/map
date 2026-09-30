# 助老地图前端界面统一改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将助老地图前端重构为按角色和任务组织的响应式页面，采用已确认的城市蓝视觉规范，并保持网页、手机 WebView 和既有业务接口兼容。

**Architecture:** 使用 Vue Router hash 路由区分老人、家属、管理员和认证流程；把共享页面外壳、业务页面、可复用组件、状态 composables 和 API services 分层。手机采用单任务页面和一级底部导航，桌面采用角色侧栏及地图/内容分栏；状态留在按业务划分的 Composition API composables 中，不新增全局状态库。

**Tech Stack:** Vue 3 Composition API、Vue Router、Vite、Capacitor、CSS custom properties、Node.js 内置 `node:test`。

---

## 文件职责地图

| 路径 | 职责 |
|---|---|
| `frontend/src/main.js` | 创建 Vue 应用、注册 Router、挂载根组件 |
| `frontend/src/App.vue` | 根级 RouterView 和全局对话框，不再拥有所有页面业务状态 |
| `frontend/src/router/index.js` | hash history、页面路由、兼容旧 `#/admin` 和角色路由守卫 |
| `frontend/src/router/policy.js` | 纯路由策略函数，供浏览器路由和 Node 单测共用 |
| `frontend/src/layouts/AuthLayout.vue` | 登录、访客介绍、首次画像等无主导航外壳 |
| `frontend/src/layouts/ElderLayout.vue` | 老人/访客一级底部导航、桌面侧栏和子页返回区 |
| `frontend/src/layouts/FamilyLayout.vue` | 家属端专用导航和响应式内容区 |
| `frontend/src/layouts/AdminLayout.vue` | 管理端侧栏/窄屏导航、工作区和退出入口 |
| `frontend/src/components/ui/` | 统一按钮、标题、表单字段、提示等视觉基础组件 |
| `frontend/src/components/elder/` | 老人端路线卡、导航提示和求助等业务组件 |
| `frontend/src/components/family/` | 家属状态卡和告警列表 |
| `frontend/src/components/admin/` | 审核表、补点工作区和照片对照 |
| `frontend/src/composables/useAuthSession.js` | 老人/家属/管理员登录状态与会话操作 |
| `frontend/src/composables/useRoutePlanner.js` | 路线输入、偏好、候选方案和导航切换状态/API |
| `frontend/src/composables/useMapData.js` | 试点区域、路线 GeoJSON、诊断建议和地图错误状态 |
| `frontend/src/composables/useCollectionWorkflow.js` | 现场采集、管理员审核、待审核记录和提交状态 |
| `frontend/src/composables/useFamilyMonitor.js` | 家属绑定、监控刷新和定时器生命周期 |
| `frontend/src/composables/useSurveyRecords.js` | 独立踩点资料、地点筛选、管理员位置更新状态 |
| `frontend/src/services/apiClient.js` | 统一 API base URL、JSON 解析、错误格式和 bearer token header |
| `frontend/src/styles/tokens.css` | 设计颜色、文字、尺寸、层级 tokens |
| `frontend/src/styles/base.css` | reset、字体、焦点环、全局基础行为和减少动态效果 |
| `frontend/src/styles/layouts.css` | 页面壳、断点、导航、安全区和桌面分栏 |
| `frontend/src/styles.css` | 迁移期间的旧样式入口，最后只保留导入或删除并更新 `main.js` |
| `frontend/tests/router-policy.test.js` | 不依赖 DOM 的路由兼容与角色访问策略测试 |

现有页面继续从 `frontend/src/pages/` 按职责拆分：`ElderPage.vue` 为老人首页，`RouteOptionsPage.vue` 呈现路线比较，`RecommendPage.vue` 专门承载路线条件调整并从路线方案页进入，`NavigationPage.vue` 为专注导航页；`SurveyRecordsPage.vue`、`ProfilePage.vue`、`FamilyPage.vue`、`FamilyBindingPage.vue`、`AdminPage.vue`、`CollectPage.vue`、`AdminSurveyPlacementPage.vue`、`LoginPage.vue`、`GuestProfilePage.vue` 和 `AdminLoginPage.vue` 继续保留对应业务职责。

## 实施任务

### Task 1: 路由基础与旧入口兼容

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/main.js`
- Modify: `frontend/src/App.vue`
- Create: `frontend/src/router/index.js`
- Create: `frontend/src/router/policy.js`
- Create: `frontend/tests/router-policy.test.js`

- [x] **Step 1: 为旧管理员入口和访问策略写失败测试**

在 `frontend/tests/router-policy.test.js` 使用 Node 内置测试框架写以下断言：`legacyAdminRedirect('/admin')` 返回 `'/admin/login'`；普通老人路由对访客开放；`requiresAdmin` 路由没有有效管理员 token 时拒绝进入，有有效 token 时允许进入。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyAdminRedirect, canEnterRoute } from '../src/router/policy.js';

test('legacy admin URL redirects to the login page', () => {
  assert.equal(legacyAdminRedirect('/admin'), '/admin/login');
});

test('admin routes require an admin token', () => {
  assert.equal(canEnterRoute({ requiresAdmin: true }, ''), false);
  assert.equal(canEnterRoute({ requiresAdmin: true }, 'signed-token'), true);
  assert.equal(canEnterRoute({}, ''), true);
});
```

- [x] **Step 2: 运行测试确认策略模块尚不存在**

运行：`node --test tests/router-policy.test.js`（工作目录 `frontend`）。预期测试因 `../src/router/policy.js` 不存在而失败。

- [x] **Step 3: 安装 Vue Router 并实现纯策略函数**

运行 `npm install vue-router`，并在 `frontend/package.json` 增加 `"test": "node --test"` 脚本（安装命令会同步更新 lockfile）。在 `frontend/src/router/policy.js` 提供以下可单测函数：

```js
export function legacyAdminRedirect(path) {
  return path === '/admin' ? '/admin/login' : null;
}

export function canEnterRoute(meta, adminToken) {
  return !meta.requiresAdmin || Boolean(adminToken);
}
```

- [x] **Step 4: 建立 hash 路由并挂载 Router**

在 `frontend/src/router/index.js` 用 `createWebHashHistory()` 注册下表中的首批已存在页面；路线比较页在 Task 3 新建后加入 `/elder/routes`。管理员业务页面（`/admin/overview`、`/admin/collect`、`/admin/survey-placement`）标记 `meta.requiresAdmin = true`；`/admin/login` 不设该标记。未知地址转到 `/login`。

| 路径 | 页面组件 | 访问策略 |
|---|---|---|
| `/login` | `LoginPage.vue` | 公开 |
| `/guest/profile` | `GuestProfilePage.vue` | 公开 |
| `/elder/home` | `ElderPage.vue` | 公开访客/老人 |
| `/elder/plan` | `RecommendPage.vue` | 公开访客/老人 |
| `/elder/navigation` | `NavigationPage.vue` | 公开访客/老人，`hidePrimaryNav` |
| `/elder/survey` | `SurveyRecordsPage.vue` | 公开访客/老人 |
| `/elder/profile` | `ProfilePage.vue` | 公开访客/老人 |
| `/family/dashboard` | `FamilyPage.vue` | 家属会话；由页面会话逻辑校验 |
| `/family/binding` | `FamilyBindingPage.vue` | 家属会话；由页面会话逻辑校验 |
| `/admin/login` | `AdminLoginPage.vue` | 公开 |
| `/admin/overview` | `AdminPage.vue` | 管理员 token |
| `/admin/collect` | `CollectPage.vue` | 管理员 token |
| `/admin/survey-placement` | `AdminSurveyPlacementPage.vue` | 管理员 token |

```js
import { createRouter, createWebHashHistory } from 'vue-router';
import { canEnterRoute, legacyAdminRedirect } from './policy.js';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    // 按上表逐条注册页面；管理员业务页面统一设置 meta.requiresAdmin。
    { path: '/admin', redirect: () => legacyAdminRedirect('/admin') },
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
});

router.beforeEach((to) => {
  const legacyTarget = legacyAdminRedirect(to.path);
  if (legacyTarget) return legacyTarget;
  const adminToken = sessionStorage.getItem('adminAccessToken') ?? '';
  if (!canEnterRoute(to.meta, adminToken)) return '/admin/login';
  return true;
});
```

在 `frontend/src/main.js` 使用 `createApp(App).use(router).mount('#app')`。先令 `App.vue` 渲染 `<RouterView />`，保留全局提示容器，后续任务再迁移页面逻辑。

- [x] **Step 5: 验证路由策略和生产构建**

运行 `npm test` 和 `npm run build`（均在 `frontend`）。预期路由测试通过且 Vite 生产构建成功。

- [x] **Step 6: 提交路由基础**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/main.js frontend/src/App.vue frontend/src/router frontend/tests/router-policy.test.js
git commit -m "feat: add role-aware frontend routing"
```

### Task 2: 会话与 API 服务抽离

**Files:**
- Create: `frontend/src/services/apiClient.js`
- Create: `frontend/src/composables/useAuthSession.js`
- Modify: `frontend/src/pages/LoginPage.vue`
- Modify: `frontend/src/pages/AdminLoginPage.vue`
- Modify: `frontend/src/pages/GuestProfilePage.vue`
- Modify: `frontend/src/pages/ProfilePage.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/App.vue`

- [x] **Step 1: 盘点并锁定登录契约**

从现有 `frontend/src/App.vue` 保留老人登录、家属登录、管理员登录、访客进入、资料更新、退出的 URL、请求体和本地存储键。管理员登录必须保存 `access_token` 到仅当前会话使用的 `sessionStorage.adminAccessToken`；不得把 token 写进用户资料 localStorage。明确 `elderMapUser`、`familyMapUser` 和 `mapLastLoginRole` 的现有含义，在迁移中保持兼容；恢复旧资料时删除历史明文密码字段及 `adminMapCredentials`，不再用缓存信息绕过密码校验。

- [x] **Step 2: 实现共享 API 请求封装**

创建 `apiClient.js` 的 `apiRequest(path, options = {})`：拼接 `API_BASE_URL`；有 body 时设置 JSON content type 并序列化；有 token 时设置 `Authorization: Bearer …`；尝试 JSON 解析；非 2xx 时抛出 `Error`，优先使用后端 `detail` 字符串，不把原始响应对象传给组件。

```js
import { API_BASE_URL } from '../config/api.js';

export async function apiRequest(path, { token, body, headers = {}, ...options } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : '请求失败，请稍后重试。';
    throw new Error(detail);
  }
  return payload;
}
```

- [x] **Step 3: 迁移角色会话 composable**

在 `useAuthSession.js` 建立模块级 `ref` 会话和方法 `restoreSession()`、`loginElder()`、`loginFamily()`、`loginAdmin()`、`enterGuestMode()`、`logout()`、`updateProfile()`。组件只触发方法和显示返回状态，不直接访问 `localStorage`、`sessionStorage` 或 `fetch`。

- [x] **Step 4: 接上登录页面和路由守卫**

将 `LoginPage.vue`、`AdminLoginPage.vue`、`GuestProfilePage.vue` 和 `ProfilePage.vue` 改为调用会话 composable；登录成功后通过 `router.replace()` 进入对应角色首页。管理员 token 仍由 `sessionStorage` 保存，并由 `router.beforeEach` 验证存在性；后台 API 继续用 token 做最终授权。

- [x] **Step 5: 验证旧登录与错误提示**

运行 `npm test` 和 `npm run build`。开发模式手工验证：老人登录成功/失败、家属登录/绑定、访客入口、管理员登录/退出；普通账号资料兼容恢复；管理员 token 在同一标签页刷新后仍只从 `sessionStorage` 恢复，没有 token 时受保护路由回到登录且后台 API 仍由服务端鉴权。确认旧缓存中的老人/管理员密码会被清除，不再提供绕过密码校验的快速登录。

- [x] **Step 6: 提交会话服务**

```powershell
git add frontend/src/services/apiClient.js frontend/src/composables/useAuthSession.js frontend/src/pages/LoginPage.vue frontend/src/pages/AdminLoginPage.vue frontend/src/pages/GuestProfilePage.vue frontend/src/pages/ProfilePage.vue frontend/src/router/index.js frontend/src/App.vue
git commit -m "refactor: extract frontend session and api services"
```

> Task 1–2 的路由过渡层与会话迁移共同改动 `App.vue`，已合并提交为 `86f26dd feat: add routed frontend session foundation`。

### Task 3: 路线、地图和导航状态拆分

**Files:**
- Create: `frontend/src/composables/useRoutePlanner.js`
- Create: `frontend/src/composables/useMapData.js`
- Modify: `frontend/src/pages/ElderPage.vue`
- Modify: `frontend/src/pages/RecommendPage.vue`
- Modify: `frontend/src/pages/NavigationPage.vue`
- Modify: `frontend/src/components/RouteCard.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/App.vue`

- [x] **Step 1: 将 App.vue 中路线/地图状态迁至 composables**

从 App.vue 提取 `startName`、`endName`、`mobilityType`、`routeStrategy`、`routes`、`avoidedSegments`、`selectedRouteIndex`、`selectedSegmentCode`、请求 loading/error/action 状态及原有路线 API 方法。`useRoutePlanner` 提供 `planRoutes()`、`selectRoute(index)`、`startNavigation()`、`returnToOptions()`；`useMapData` 提供 `loadMapData()`、`retryMapData()` 和地图错误/重试状态。 composables 返回可组合 refs 和方法，不接管地图组件渲染。

- [x] **Step 2: 让首页提交转为显式路线页面流**

`ElderPage.vue` 保留当前位置、目的地和常用行动；提交成功规划时以 `router.push('/elder/routes')` 进入候选方案页。未成功时留在首页并展示错误，不清空用户已填写的位置。

- [x] **Step 3: 分离条件页和候选路线页**

新增 `frontend/src/pages/RouteOptionsPage.vue`，组合已有 `RouteCard.vue` 和地图组件，显示候选路线、适老原因、风险提示、路线现场证据；`RecommendPage.vue` 只保留地点、画像、路线策略等规划条件，从路线方案页的“修改条件”入口进入。候选路线在路由切换间由 `useRoutePlanner` 保留，不因页面 unmount 丢失。

- [x] **Step 4: 将导航页设为专注模式**

`NavigationPage.vue` 读取 composable 中的当前路线和地图数据，提供明确的返回路线方案与结束导航操作。导航时不渲染老人一级底部导航；地图不可用时仍展示文字指令、错误原因和重试入口。紧急求助仍调用原 API，只能因显式点击发送。

- [x] **Step 5: 验证路线和导航状态**

运行 `npm run build`。手工完成“首页填地点 → 规划失败保留输入 → 规划成功 → 选择不同路线 → 进入导航 → 返回方案 → 结束导航”流程，确认 API 请求体与旧版一致。

- [ ] **Step 6: 提交路线页面拆分**

```powershell
git add frontend/src/composables/useRoutePlanner.js frontend/src/composables/useMapData.js frontend/src/pages/ElderPage.vue frontend/src/pages/RecommendPage.vue frontend/src/pages/RouteOptionsPage.vue frontend/src/pages/NavigationPage.vue frontend/src/components/RouteCard.vue frontend/src/router/index.js frontend/src/App.vue
git commit -m "refactor: split elder route and navigation flow"
```

### Task 4: 角色布局和通用视觉组件

**Files:**
- Create: `frontend/src/layouts/AuthLayout.vue`
- Create: `frontend/src/layouts/ElderLayout.vue`
- Create: `frontend/src/layouts/FamilyLayout.vue`
- Create: `frontend/src/layouts/AdminLayout.vue`
- Create: `frontend/src/components/ui/AppButton.vue`
- Create: `frontend/src/components/ui/PageHeader.vue`
- Create: `frontend/src/components/ui/StatusNotice.vue`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/base.css`
- Create: `frontend/src/styles/layouts.css`
- Modify: `frontend/src/components/PageNavigation.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/main.js`

- [x] **Step 1: 建立设计 token 和基础样式**

按设计说明在 `tokens.css` 定义六色 token、基础文字和间距变量；`base.css` 设置系统中文字体、box sizing、表单继承字体、可见焦点环、对比度状态色和 `prefers-reduced-motion`。不把旧暖绿背景和大渐变带入新角色布局。

```css
:root {
  --color-ink: #203747;
  --color-primary: #286887;
  --color-primary-soft: #e5eff3;
  --color-page: #f3f6f8;
  --color-surface: #ffffff;
  --color-caution: #a96819;
  --text-body: 1rem;
  --content-max: 90rem;
  --touch-min: 3rem;
}
```

- [x] **Step 2: 实现最小共享按钮、标题和状态提示**

`AppButton.vue` 接收 `variant`、`disabled` 和原生 button 属性；`PageHeader.vue` 接收 `title`、可选 `description` 和返回事件；`StatusNotice.vue` 接收 `kind`、`title` 和正文 slot。所有控件提供 `:focus-visible` 样式，不把禁用/加载只表示为颜色。

- [x] **Step 3: 实现老人端响应式外壳**

`ElderLayout.vue` 在窄屏显示标题栏、router-view 和安全区预留的一级底部导航；`route.meta.hidePrimaryNav` 为 true 的子任务隐藏底栏并显示返回标题。宽屏换为侧边导航。`PageNavigation.vue` 使用 RouterLink，仅列首页、路线、踩点资料、我的四个入口。

- [x] **Step 4: 实现家属、管理员和认证外壳**

`FamilyLayout.vue` 和 `AdminLayout.vue` 各自使用角色导航项；管理员窄屏使用可滚动顶部导航，桌面使用固定宽度侧栏。`AuthLayout.vue` 只提供窄幅登录/访客内容区，不显示业务导航。路由记录挂载相应 layout，不重复嵌套或渲染多个导航栏。

- [ ] **Step 5: 验证断点、焦点和安全区**

运行 `npm run build`，然后在浏览器检查 320px、390px、768px 和 1366px：底部栏不覆盖按钮；键盘 Tab 可见焦点；长内容纵向滚动；导航子页没有一级 tab；桌面侧栏不挤压主要区域。

- [ ] **Step 6: 提交基础视觉与外壳**

```powershell
git add frontend/src/layouts frontend/src/components/ui frontend/src/styles/tokens.css frontend/src/styles/base.css frontend/src/styles/layouts.css frontend/src/components/PageNavigation.vue frontend/src/router/index.js frontend/src/main.js
git commit -m "feat: add responsive role layouts and ui primitives"
```

### Task 5: 采集、踩点资料与照片状态 composables

**Files:**
- Create: `frontend/src/composables/useCollectionWorkflow.js`
- Create: `frontend/src/composables/useFamilyMonitor.js`
- Create: `frontend/src/composables/useSurveyRecords.js`
- Modify: `frontend/src/pages/CollectPage.vue`
- Modify: `frontend/src/pages/FamilyPage.vue`
- Modify: `frontend/src/pages/FamilyBindingPage.vue`
- Modify: `frontend/src/pages/SurveyRecordsPage.vue`
- Modify: `frontend/src/pages/AdminSurveyPlacementPage.vue`
- Modify: `frontend/src/services/apiClient.js`

- [x] **Step 1: 抽离现场采集和审核请求**

`useCollectionWorkflow.js` 管理路段下拉数据、采集表单、定位、提交状态、待审核列表和审核操作。现场提交保持无需管理员 token；待审核 GET 和审核 POST 必须通过 `apiRequest` 携带当前管理员 bearer token。审核完成后刷新待审核项与正式地图数据，不允许重复点击导致重复提交。

- [x] **Step 2: 抽离家属监控及定时器**

`useFamilyMonitor.js` 管理绑定查询、监控快照、告警和刷新定时器。进入家属页启动轮询，离开角色壳或退出登录时清除 interval；绑定失败时保留输入并显示具体错误。

- [x] **Step 3: 抽离踩点清单和管理落点请求**

`useSurveyRecords.js` 管理站点、GeoJSON、筛选、照片 lightbox 选择、地图待选坐标与保存。普通用户 GET 继续只读；管理员 PATCH 使用 token；手动落点成功只更新位置来源，不把审核状态改为通过。

- [x] **Step 4: 精简页面组件**

将 `CollectPage.vue`、`FamilyPage.vue`、`FamilyBindingPage.vue`、`SurveyRecordsPage.vue`、`AdminSurveyPlacementPage.vue` 改为页面编排组件；API 和跨页数据状态从组件移出。保留现有空状态、地点加载错误、记录加载错误、地图加载降级和成功/失败反馈。

- [ ] **Step 5: 验证权限和数据边界**

运行 `npm run build`。分别以访客、老人、家属和管理员打开路由；网络面板确认 `GET /api/collect/pending`、`POST /api/collect/segments/{id}/audit`、`PATCH /api/survey-records/{code}/location` 都携带 bearer token；检查未定位记录没有地图 marker，踩点 PATCH 后状态仍待核查。

审查发现一个范围外但重要的既有风险：`backend/app/api/routes/auth.py` 的家属监控查询只按 URL 中的家属 ID 取数，没有在服务端校验调用者身份/绑定关系。当前前端计划不修改 API 鉴权；在此风险处理前，不应把该端点视为对外部署安全。

- [ ] **Step 6: 提交资料与采集 composables**

```powershell
git add frontend/src/composables/useCollectionWorkflow.js frontend/src/composables/useFamilyMonitor.js frontend/src/composables/useSurveyRecords.js frontend/src/pages/CollectPage.vue frontend/src/pages/FamilyPage.vue frontend/src/pages/FamilyBindingPage.vue frontend/src/pages/SurveyRecordsPage.vue frontend/src/pages/AdminSurveyPlacementPage.vue frontend/src/services/apiClient.js
git commit -m "refactor: isolate collection family and survey workflows"
```

### Task 6: 老人端首页和路线方案细节

**Files:**
- Modify: `frontend/src/pages/ElderPage.vue`
- Modify: `frontend/src/pages/RecommendPage.vue`
- Modify: `frontend/src/pages/RouteOptionsPage.vue`
- Create: `frontend/src/components/elder/DestinationForm.vue`
- Create: `frontend/src/components/elder/MobilityPreferencePicker.vue`
- Create: `frontend/src/components/elder/RouteOptionCard.vue`
- Modify: `frontend/src/components/LocationInput.vue`
- Modify: `frontend/src/components/StrategySelector.vue`
- Modify: `frontend/src/components/RouteCard.vue`

- [x] **Step 1: 拆分目的地表单**

把起点、目的地和提交按钮组成 `DestinationForm.vue`；地点自动完成输入保持 label、键盘选择、清空和错误关联。首页只保留“您要去哪里？”、地点表单、明确的“查看适老路线”按钮和少量快捷偏好，不再展示路线明细长内容。

- [x] **Step 2: 拆分老人出行偏好**

`MobilityPreferencePicker.vue` 展示现有轮椅、拐杖、慢行、独立出行、家属陪同选项；所有原值和请求字段不变；移动端单列大按钮，桌面最多两列，当前项同时用边框/文字状态表达，不只变色。

- [x] **Step 3: 实现独立路线比较页**

`RouteOptionsPage.vue` 将每条路线的距离、预估时间、坡度/台阶/休息信息与路线卡关联；选中路线使用明确的边框与“已选择”文本。手机列表优先显示可读路线卡，地图作为可打开的路线预览；宽屏路线卡与地图并排。

- [x] **Step 4: 明确条件、加载、空和失败状态**

在 `RecommendPage.vue` 保留策略选择和重新规划；无结果时显示“请先生成路线”和返回修改入口；加载时禁用重复提交并显示进度；错误与成功文案紧邻触发操作。

- [ ] **Step 5: 验证老人端关键路径**

运行 `npm run build`。使用 320px 与 390px 设备视口检查起点/终点操作不超宽，路线卡不依赖横滑；桌面检查地图与比较列表同时可见；验证导航偏好、路线顺序和选中状态与 API 返回一致。

- [ ] **Step 6: 提交老人路线页面**

```powershell
git add frontend/src/pages/ElderPage.vue frontend/src/pages/RecommendPage.vue frontend/src/pages/RouteOptionsPage.vue frontend/src/components/elder/DestinationForm.vue frontend/src/components/elder/MobilityPreferencePicker.vue frontend/src/components/elder/RouteOptionCard.vue frontend/src/components/LocationInput.vue frontend/src/components/StrategySelector.vue frontend/src/components/RouteCard.vue
git commit -m "feat: simplify elder route planning screens"
```

### Task 7: 家属、管理员、登录与资料页面统一

**Files:**
- Modify: `frontend/src/pages/LoginPage.vue`
- Modify: `frontend/src/pages/AdminLoginPage.vue`
- Modify: `frontend/src/pages/GuestProfilePage.vue`
- Modify: `frontend/src/pages/ProfilePage.vue`
- Modify: `frontend/src/pages/FamilyPage.vue`
- Modify: `frontend/src/pages/FamilyBindingPage.vue`
- Modify: `frontend/src/pages/AdminPage.vue`
- Modify: `frontend/src/pages/CollectPage.vue`
- Modify: `frontend/src/pages/AdminSurveyPlacementPage.vue`
- Create: `frontend/src/components/family/ElderStatusCard.vue`
- Create: `frontend/src/components/family/AlertList.vue`
- Create: `frontend/src/components/admin/CollectionReviewTable.vue`
- Create: `frontend/src/components/admin/SurveyPlacementWorkspace.vue`

- [x] **Step 1: 登录与访客页面使用共用基础组件**

将登录、管理员登录和访客资料页接入 `AuthLayout`；个人资料页接入 `ElderLayout`。统一标题、表单字段、按钮和错误提示。登录失败时不清空非密码输入，不将管理员 token 展示为文本。

- [x] **Step 2: 家属首页拆分信息组件**

`ElderStatusCard.vue` 显示老人姓名、当前状态和更新时间；`AlertList.vue` 展示告警类型、时间与状态。家属首页先呈现安全/告警信息，再呈现绑定管理；无绑定、加载中、接口失败分别有可操作说明。

- [x] **Step 3: 管理员审核表和补点空间独立**

`CollectionReviewTable.vue` 只负责待审数据与审核动作；`SurveyPlacementWorkspace.vue` 负责现场图/地图截图对照、搜索、地图点选和保存。主后台使用角色侧栏，窄屏转为紧凑顶部导航；所有管理请求保留 bearer token。

- [ ] **Step 4: 验证家属及管理端角色隔离**

运行 `npm run build`。确认老人用户无法直接进入管理员路由；管理员退出后不能通过浏览器返回看到受保护内容；家属绑定失败可恢复输入；手机端管理员审核区域不造成整页横向溢出（仅确有宽表格处允许内部滚动）。

- [ ] **Step 5: 提交角色页面**

```powershell
git add frontend/src/pages/LoginPage.vue frontend/src/pages/AdminLoginPage.vue frontend/src/pages/GuestProfilePage.vue frontend/src/pages/ProfilePage.vue frontend/src/pages/FamilyPage.vue frontend/src/pages/FamilyBindingPage.vue frontend/src/pages/AdminPage.vue frontend/src/pages/CollectPage.vue frontend/src/pages/AdminSurveyPlacementPage.vue frontend/src/components/family frontend/src/components/admin
git commit -m "refactor: unify family and admin workspaces"
```

### Task 8: 样式迁移、适老可访问性与最终回归

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/base.css`
- Modify: `frontend/src/styles/layouts.css`
- Modify: page/component scoped styles under `frontend/src/pages/` and `frontend/src/components/`
- Modify: `frontend/src/main.js`
- Modify: `README.md`

- [ ] **Step 1: 按已迁移页面清理旧全局规则**

每个页面完成时将其专属选择器移入对应 Vue SFC 的 `<style scoped>`；跨页基础组件留在 `components/ui/`；壳和断点只留在 `layouts.css`。清理旧叶绿/暖纸 token、相互覆盖的重复断点和不再使用的类，不一次性删除仍被页面使用的旧样式。

- [ ] **Step 2: 统一触控、对比和窄屏细节**

执行设计说明中的颜色/字号/触控尺寸；确认地图容器用内容约束而非固定整页高度；按钮、返回入口、输入控件最小 48px；图片 lightbox 可通过关闭按钮/ESC 关闭；状态有文字并有键盘焦点。媒体查询集中在 `layouts.css` 的 767px、1023px 断点，必要的局部例外写在相关组件并注明用途。

- [x] **Step 3: 更新入口和运行说明**

`main.js` 只导入 tokens、base 和 layouts 三类全局样式，其余页面样式由组件管理。README 前端说明列出 `npm install`、`npm run dev`、`npm run build`，并注明 Vue Router 使用 hash URL；不写入任何 `.env` 值或密钥。

- [x] **Step 4: 执行生产构建和现有后端回归**

运行：

```powershell
Set-Location F:\items\map\frontend
npm test
npm run build
Set-Location F:\items\map\backend
..\.conda\elder-map-py311\python.exe -m pytest -q
```

预期：路由策略测试通过、Vite 生产构建成功；后端既有测试通过（本机 PostGIS 未启动时允许既有 PostGIS 集成用例按标记跳过，并在交付说明中标出）。

- [ ] **Step 5: 完成手工屏幕矩阵**

在浏览器设备工具与实际手机 WebView 各检查：320×640、390×844、768×1024、1366×768。覆盖登录、老人首页、路线条件、路线方案、导航、踩点资料、家属首页/绑定、管理员审核/补点。逐项确认：没有整页横向溢出；关键操作可触达；长页面能滚动；底部导航不挡内容；桌面地图/面板并列；所有 API 错误和空状态可理解；地图失败不阻断可用的文字内容。

- [x] **Step 6: 验证 Android WebView 资源同步（仅在环境配置齐全时）**

若 `VITE_API_BASE_URL` 的生产配置已按项目 `.env.production.example` 提供且 Android SDK 可用，运行 `npm run android:sync`，确认 `frontend/android/app/src/main/assets/public` 中加载的是新构建页面。若缺少生产 API 地址或签名/SDK 配置，只做 `npm run build` 并明确记录 APK 未构建，不猜测服务器或热点地址。

本轮检查没有 `frontend/.env.production`，因此未执行 Android WebView 同步；APK 未重建。静态预览仍在 `http://localhost:4173/`。

- [x] **Step 7: 做最终差异检查并提交**

运行 `git diff --check`；确认本次暂存内容不含 `.env`、原始照片或 `map.zip`（这些用户数据可继续保持未跟踪）；确认没有服务端/路线接口变更。提交：

```powershell
git add frontend README.md
git commit -m "feat: refresh responsive accessible app interface"
```

## 最终验收清单

- [ ] 城市蓝色板、文字层级和克制表面处理在老人、家属、管理员页面保持一致。
- [ ] 移动端按任务分页面，内容自然滚动，导航中使用专注布局。
- [ ] 桌面端使用角色侧栏和合理的地图/任务分栏。
- [ ] `App.vue` 不再包含全部角色页、所有 API 请求和全部流程状态。
- [ ] CSS 不再由单个超长全局样式表承载所有页面规则。
- [ ] Vue Router hash URL、浏览器返回和旧管理员 URL 兼容。
- [ ] 管理 API token、原业务请求和踩点/正式路网数据边界没有回归。
- [ ] 自动构建、路由策略测试和手工视口矩阵通过；数据库未启动、APK 环境未配置等未验证项如实说明。
