# Speech and navigation experience Implementation Plan

> **For agentic workers:** 当前会话实施，用户沿用自主审批；完成后独立审查并保存Git。

**Goal:** 本地语音转写可编辑确认、可靠中文播报，以及可操作的分段导航和定位反馈。
**Architecture:** FastAPI speech服务封装faster-whisper；前端录音/TTS/导航为独立服务或composable，页面只编排。地图位置与选段样式独立于静态路网更新。
**Tech Stack:** Vue、FastAPI、faster-whisper、PyAV、MediaRecorder、SpeechSynthesis、Capacitor Geolocation。

## 1. 本地ASR
- [ ] 安装faster-whisper/python-multipart并登记依赖；准备显式下载脚本和模型忽略规则。
- [ ] speech service/schema/router：有限读取、有限解码、懒加载本地CPU模型、busy锁及中文错误。
- [ ] 后端测试覆盖大小、格式、时长、离线和成功；显式准备模型，中文样例真实验证。

## 2. 语音与地点
- [ ] speechInput服务控制录音、取消、时限、权限和上传，VoiceInput复用到地点与助手。
- [ ] 地点唯一匹配才能选中；助手识别结果进入草稿，用户确认发送。
- [ ] speechOutput统一中文声音、播放/停止/失败；助手可朗读回答，离页停止。
- [ ] 单元和浏览器测试验证录音与TTS事件，不把模拟硬件称作真机。

## 3. 分段指引及定位
- [ ] navigation composable负责当前段、估算剩余距离、休息和定位质量/偏离状态；纯函数地理模块对照后端坐标转换测试。
- [ ] deviceLocation连续watch封装浏览器/原生权限与清理；App同步当前段给SOS/家属，NavigationPage实现可触达控制与结束确认。
- [ ] AmapRouteMap元素ref和卸载保护，选段不自动缩放，位置marker/精度独立更新；FallbackRouteMap补位置和空数据说明。
- [ ] 测试分段、风险、GPS过期/误差/偏离阈值、地图加载卸载及手机布局。

## 4. 完成
- [ ] 前后端回归、生产构建、浏览器语音/导航检查和真实ASR样例。
- [ ] 独立审查、更新文档/实际验证记录、git diff --check、提交。
