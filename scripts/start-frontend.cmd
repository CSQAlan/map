@echo off
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%\frontend"
npm.cmd run dev 1>"%PROJECT_ROOT%\.logs\frontend.log" 2>"%PROJECT_ROOT%\.logs\frontend.err"
