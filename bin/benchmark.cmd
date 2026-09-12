@echo off
set "PROJECT_ROOT=%~dp0..\..\.."
node "%~dp0..\src\cli.js" benchmark --project-root "%PROJECT_ROOT%" %*
exit /b %ERRORLEVEL%
