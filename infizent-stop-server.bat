@echo off
:: ============================================================================
:: Infizent Technology - stop the production server window
:: ----------------------------------------------------------------------------
:: Closes any window whose title matches the launcher's title. Does NOT kill
:: every node.exe on the system — it scopes by window title to avoid hitting
:: unrelated Node processes (e.g. a developer's editor, the renderer dev
:: server, or scheduled tasks).
:: ============================================================================

setlocal

echo Stopping Infizent server windows...

:: /fi filters by window title; without /im this matches the cmd.exe window
:: hosting the launcher (whose title we set with `title ...` in the .bat),
:: which also terminates the child node.exe it spawned.
taskkill /f /fi "WINDOWTITLE eq Infizent Technology - Production Server*" >nul 2>nul

if errorlevel 1 (
    echo No matching server window was running.
) else (
    echo Done.
)

echo.
pause
endlocal
