@echo off
set "PROJECT_ROOT=%~dp0..\..\.."
node "%~dp0..\src\cli.js" audit --project-root "%PROJECT_ROOT%" %*
exit /b %ERRORLEVEL%
