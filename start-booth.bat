@echo off
rem Photobooth launcher (Windows)
rem   start-booth.bat         -> app window, goes fullscreen on first touch, silent printing
rem   start-booth.bat setup   -> app window with the print dialog (for printer setup)
rem Fullscreen / window mode / which monitor: admin menu (tap top-left corner 5 times)
cd /d "%~dp0"

start "photobooth-server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
timeout /t 2 /nobreak >nul

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo Chrome or Edge not found.
  pause
  exit /b 1
)

set "URL=http://localhost:8787/booth/"
set "FLAGS=--user-data-dir="%~dp0.browser-profile" --no-first-run --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-pinch --overscroll-history-navigation=0 --disable-features=TranslateUI --disable-session-crashed-bubble --start-maximized"

if /i "%~1"=="setup" (
  start "" "%BROWSER%" %FLAGS% --app="%URL%"
) else (
  start "" "%BROWSER%" %FLAGS% --kiosk-printing --app="%URL%"
)
