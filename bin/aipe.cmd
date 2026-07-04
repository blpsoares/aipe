@echo off
rem AIPe launcher (Windows). Resolves the standalone binary for this host and
rem execs it — no Bun/Node required at runtime. Resolution order mirrors the
rem POSIX launcher: %AIPE_BIN% -> dist\ -> cache -> Bun dev fallback -> download.
setlocal
set "AIPE_VERSION=0.1.0"
set "REPO=blpsoares/aipe"
set "BIN_DIR=%~dp0"
for %%I in ("%BIN_DIR%..") do set "ROOT=%%~fI"

if defined AIPE_BIN if exist "%AIPE_BIN%" (
  "%AIPE_BIN%" %*
  exit /b %ERRORLEVEL%
)

set "LABEL=windows-x64"
set "CANDIDATE=%ROOT%\dist\aipe-%LABEL%.exe"
if exist "%CANDIDATE%" (
  "%CANDIDATE%" %*
  exit /b %ERRORLEVEL%
)

set "CACHE=%LOCALAPPDATA%\aipe\%AIPE_VERSION%\aipe-%LABEL%.exe"
if exist "%CACHE%" (
  "%CACHE%" %*
  exit /b %ERRORLEVEL%
)

where bun >nul 2>nul
if %ERRORLEVEL%==0 if exist "%ROOT%\src\cli.ts" (
  bun "%ROOT%\src\cli.ts" %*
  exit /b %ERRORLEVEL%
)

set "URL=https://github.com/%REPO%/releases/download/v%AIPE_VERSION%/aipe-%LABEL%.exe"
if not exist "%LOCALAPPDATA%\aipe\%AIPE_VERSION%" mkdir "%LOCALAPPDATA%\aipe\%AIPE_VERSION%" >nul 2>nul
where curl >nul 2>nul
if %ERRORLEVEL%==0 (
  curl -fsSL "%URL%" -o "%CACHE%"
  if exist "%CACHE%" (
    "%CACHE%" %*
    exit /b %ERRORLEVEL%
  )
)

echo aipe: no runnable binary for %LABEL% and no Bun on PATH. 1>&2
echo        Build one with "bun run scripts/build.ts host", or install Bun (https://bun.sh). 1>&2
exit /b 127
