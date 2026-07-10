@echo off
REM Stop the dashboard servers started by run-dev.bat (frees ports 8000 / 5173).
echo Stopping backend (:8000) and frontend (:5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
echo Done.
