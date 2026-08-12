@echo off
:: ============================================================================
:: Infizent Technology — Production Server launcher (host PC)
:: ----------------------------------------------------------------------------
:: Reads .env in the same folder as this script, sets each KEY=VALUE pair as
:: an environment variable for the lifetime of this window, then runs the
:: compiled Node server. Keep this window open all day; close it to stop.
:: ----------------------------------------------------------------------------
:: For Infizent IT setup steps see OPERATOR-RUNBOOK.md.
:: ============================================================================

setlocal enabledelayedexpansion

title Infizent Technology - Production Server
echo ============================================
echo   Infizent Technology - SMT MES System
echo   Server starting...
echo ============================================
echo.

:: ----- Sanity checks -----------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not on PATH.
    echo         Install Node.js LTS from https://nodejs.org and retry.
    echo.
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "ENV_FILE=%SCRIPT_DIR%.env"
set "SERVER_JS=%SCRIPT_DIR%artifacts\api-server\dist\index.mjs"

if not exist "%ENV_FILE%" (
    echo [ERROR] Missing config file: %ENV_FILE%
    echo         Create a .env file next to this script. See OPERATOR-RUNBOOK.md.
    echo.
    pause
    exit /b 1
)

if not exist "%SERVER_JS%" (
    echo [ERROR] Server bundle not found: %SERVER_JS%
    echo         Run "pnpm run build:all" first (one-time, IT only).
    echo.
    pause
    exit /b 1
)

:: ----- Load .env ---------------------------------------------------------
echo Loading configuration from %ENV_FILE%
for /f "usebackq tokens=* eol=#" %%L in ("%ENV_FILE%") do (
    set "LINE=%%L"
    if not "!LINE!"=="" (
        for /f "tokens=1,* delims==" %%A in ("!LINE!") do (
            set "KEY=%%A"
            set "VAL=%%B"
            :: Strip surrounding double quotes from value if present
            if defined VAL (
                if "!VAL:~0,1!"=="""" if "!VAL:~-1!"=="""" set "VAL=!VAL:~1,-1!"
            )
            set "!KEY!=!VAL!"
        )
    )
)

:: ----- Defaults the server needs (the operator should NOT have to know) -
if not defined NODE_ENV   set "NODE_ENV=production"
if not defined HOST       set "HOST=0.0.0.0"
if not defined PORT       set "PORT=4000"

echo Server will listen on http://!HOST!:!PORT!
echo Press Ctrl+C in this window or close it to stop the server.
echo.

:: ----- Run ---------------------------------------------------------------
node --enable-source-maps "%SERVER_JS%"

echo.
echo ============================================
echo Server stopped.
echo ============================================
pause
endlocal
