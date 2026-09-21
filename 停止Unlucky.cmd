@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "UNLUCKY_NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto run
set "UNLUCKY_NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%UNLUCKY_NODE%" goto run
echo Node.js 24 or newer is required. Please install it and try again.
pause
exit /b 1
:run
"%UNLUCKY_NODE%" --env-file-if-exists=.env scripts/stop.js
if errorlevel 1 pause
