@echo off
setlocal

set "SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
set "SDK_MANAGER=%SDK_ROOT%\cmdline-tools\latest\bin\sdkmanager.bat"
set "LOG_PATH=%LOCALAPPDATA%\Temp\elder-map-sdk-install.log"

if not exist "%SDK_MANAGER%" (
  echo Android SDK command-line tools were not found at "%SDK_MANAGER%".
  exit /b 1
)

call "%SDK_MANAGER%" --sdk_root="%SDK_ROOT%" "platforms;android-36" "build-tools;36.0.0" >> "%LOG_PATH%" 2>&1
exit /b %errorlevel%
