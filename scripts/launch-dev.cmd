@echo off
set "PROJECT_ROOT=%~dp0.."
start "elder-map-backend" cmd /k "%PROJECT_ROOT%\scripts\start-backend.cmd"
start "elder-map-frontend" cmd /k "%PROJECT_ROOT%\scripts\start-frontend.cmd"
