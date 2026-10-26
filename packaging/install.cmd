@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

rem ============================================================
rem  dcr 安装脚本：把 dcr.exe 放到用户目录并加入 PATH，再注册 skill
rem  可选环境变量（一般不用管）：
rem    DCR_TARGET     自定义安装目录
rem    DCR_SKIP_PATH  设为 1 时跳过 PATH 修改（测试用）
rem ============================================================

set "TARGET=%DCR_TARGET%"
if "%TARGET%"=="" set "TARGET=%LOCALAPPDATA%\Programs\dcr"

echo.
echo   安装 dcr 到: %TARGET%
echo.

if not exist "%TARGET%" mkdir "%TARGET%" 2>nul
copy /y "%~dp0dcr.exe" "%TARGET%\dcr.exe" >nul
if errorlevel 1 (
  echo   [失败] 无法复制 dcr.exe，请检查目录权限。
  pause
  exit /b 1
)
echo   [完成] dcr.exe

if "%DCR_SKIP_PATH%"=="1" (
  echo   [跳过] PATH 修改
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$d = '%TARGET%';" ^
    "$p = [Environment]::GetEnvironmentVariable('Path','User');" ^
    "if ($p -split ';' -contains $d) { Write-Host '  [完成] PATH 中已存在' }" ^
    "else { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';')) + ';' + $d), 'User'); Write-Host '  [完成] 已加入 PATH' }"
)

echo.
"%TARGET%\dcr.exe" install %*

echo.
echo   重启编辑器后即可对 AI 说「整理一下这次改动」。
echo.
pause
