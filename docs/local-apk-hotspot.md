# 本地热点 Android APK 联调

该流程用于让 Android debug APK 通过电脑热点访问本机 FastAPI，不依赖云服务器。

首次构建需要 Android SDK（API 36 与 Build Tools）。若机器未安装 Android Studio，可使用 Google 官方 Command-line Tools 安装到当前用户目录；构建报错 `SDK location not found` 时，先完成这一步，再将 SDK 目录写入 `frontend/android/local.properties`：

```properties
sdk.dir=C:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

`local.properties` 是本机配置，不提交到 Git。

1. 让电脑与测试手机处于同一局域网。推荐手机打开个人热点、电脑连接该热点；也可以打开 Windows 移动热点并让手机连接。
2. 在电脑执行 `ipconfig`，找到与该热点相连网卡的 IPv4 地址。手机开热点时这是电脑获得的动态地址；Windows 开热点时常见为 `192.168.137.1`。
3. 复制 `frontend/.env.development.example` 为 `frontend/.env.development.local`，将 `VITE_API_BASE_URL` 填为 `http://电脑IPv4:8000`。不要填写 `localhost` 或 `127.0.0.1`，它们在手机中指向手机自己。
4. 启动 PostGIS 和后端：

```powershell
docker compose -f docker-compose.postgis.yml up -d
scripts\start-backend.cmd
```

5. 确认 Windows 防火墙允许热点网络访问 TCP 8000。
6. 在 `frontend` 目录构建 APK：

```powershell
npm run android:apk:lan
```

输出文件为 `frontend/android/app/build/outputs/apk/debug/app-debug.apk`。

该 debug 包仅允许局域网 HTTP，发布到远程服务时必须改用 `npm run android:build` 和 HTTPS API，不会携带此 debug 网络设置。
