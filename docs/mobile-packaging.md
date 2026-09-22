# Android App 打包与服务配置

本项目使用 Capacitor 将现有 Vue/Vite 前端封装为 Android App；FastAPI、PostgreSQL/PostGIS 和 Redis 保持部署在远程服务器。

## 构建前配置

1. 复制 `frontend/.env.production.example` 为 `frontend/.env.production`，并将 `VITE_API_BASE_URL` 改为后端公网 HTTPS 地址。
2. 在服务器上以 `backend/.env.production.example` 为模板配置后端。`CORS_ORIGINS` 必须保留 `https://localhost`，这是 Android App 内置 WebView 的来源。
3. 使用正式高德 Key，并完成与正式域名/应用匹配的安全配置后再发布。

## Android 工作流

在 `frontend` 目录执行：

```powershell
npm install
npm run android:sync
npm run android:open
```

Android Studio 中选择已连接手机或模拟器运行；生成 debug APK 可执行 `./gradlew.bat assembleDebug`（位于 `frontend/android`）。

定位调用在浏览器使用 Web Geolocation，在 Android App 使用 Capacitor 原生定位。首次定位会请求系统权限；用户拒绝后仍可不带定位提交采集记录。
