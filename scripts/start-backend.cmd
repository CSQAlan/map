@echo off
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%\backend"
"%PROJECT_ROOT%\.conda\elder-map-py311\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 1>"%PROJECT_ROOT%\.logs\backend.log" 2>"%PROJECT_ROOT%\.logs\backend.err"
