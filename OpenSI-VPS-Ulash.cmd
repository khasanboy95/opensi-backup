@echo off
chcp 65001 >nul
cd /d "%~dp0"
node deploy\connect-vps.mjs
echo.
pause
