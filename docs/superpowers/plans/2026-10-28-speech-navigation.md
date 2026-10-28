# Speech and navigation experience Implementation Plan

> **For agentic workers:** 当前会话实施，用户沿用自主审批；完成后独立审查并保存Git。

**Goal:** 本地语音转写可编辑确认、可靠中文播报，以及可操作的分段导航和定位反馈。
**Architecture:** FastAPI speech服务封装faster-whisper；前端录音/TTS/导航为独立服务或composable，页面只编排。地图位置与选段样式独立于静态路网更新。
**Tech Stack:** Vue、FastAPI、faster-whisper、PyAV、MediaRecorder、SpeechSynthesis、Capacitor Geolocation。

## 1. 本地ASR
- [x] 安装faster-whisper/python-multipart并登记依赖；准备显式下载脚本和模型忽略规则。
- [x] speech service/schema/router：有限读取、有限解码、懒加载本地CPU模型、busy锁及中文错误。
- [x] 后端测试覆盖大小、格式、时长、离线和成功；显式准备模型，中文样例真实验证。

## 2. 语音与地点
- [x] speechInput服务控制录音、取消、时限、权限和上传，VoiceInput复用到地点与助手。
- [x] 地点唯一匹配才能选中；助手识别结果进入草稿，用户确认发送。
- [x] speechOutput统一中文声音、播放/停止/失败；助手可朗读回答，离页停止。
- [x] 单元和浏览器测试验证录音与TTS事件，不把模拟硬件称作真机。

## 3. 分段指引及定位
- [x] navigation composable负责当前段、估算剩余距离、休息和定位质量/偏离状态；纯函数地理模块对照后端坐标转换测试。
- [x] deviceLocation连续watch封装浏览器/原生权限与清理；App同步当前段给SOS/家属，NavigationPage实现可触达控制与结束确认。
- [x] AmapRouteMap元素ref和卸载保护，选段不自动缩放，位置marker/精度独立更新；FallbackRouteMap补位置和空数据说明。
- [x] 测试分段、风险、GPS过期/误差/偏离阈值、地图加载卸载及手机布局。

## 4. 完成
- [x] 已执行的前后端回归、生产构建、浏览器语音/导航检查和真实ASR样例已记录；最后一轮 PostGIS 全量验证与末次打包按用户要求暂停。
- [x] 独立审查、更新文档及实际验证记录、保存 Git；用户要求暂停后不再追加验证。

## 实施记录

- 已实现本地 faster-whisper base 识别、共享录音输入、可编辑助手草稿、地点唯一匹配、统一中文播报、分段导航、休息及定位反馈。
- 导航页面负责交互状态，独立服务负责地理计算、播报、定位和家属快照同步，避免将业务算法塞入地图组件。
- 独立审查发现的结束重置、即时清理、过期快照覆盖、跨账户队列、上传解析前体积限制等问题已修复并复核。
- 用户暂停前已完成：前端69项单元测试，后端151项通过、3项PostGIS集成测试跳过；24项布局检查及语音/导航/地图浏览器流程；真实中文合成音频经ASR和Ollama的完整链路；生产构建与一次Android调试包构建。
- Docker Desktop与本机PostGIS已启动。Compose端口改为仅绑定127.0.0.1，避免用默认开发凭据向局域网开放数据库。最终启用PostGIS的全量验证和末次Android打包在用户要求下停止，不将其计为已验证。
- 真实手机麦克风、扬声器、户外GPS与噪声场景尚未验证。详细说明见 docs/local-speech-navigation.md。
