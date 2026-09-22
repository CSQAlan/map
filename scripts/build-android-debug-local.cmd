@echo off
setlocal

set "LOG_PATH=%LOCALAPPDATA%\Temp\elder-map-apk-build.log"
cd /d "%~dp0..\frontend\android"
call gradlew.bat assembleDebug --no-daemon --console=plain --info >> "%LOG_PATH%" 2>&1
exit /b %errorlevel%
