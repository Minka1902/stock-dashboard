@echo off
REM Launch the Stock Signal Dashboard backend + frontend as INDEPENDENT,
REM detached processes (each in its own minimized window). They keep running
REM until you close those windows or reboot -- they do NOT die with the
REM terminal that started them. Double-click this file, or run it from a shell.
REM
REM This is the DEV flow (2 processes, hot reload). For a single-port,
REM production-like run instead, build the frontend once and let the backend
REM serve it on :8000:
REM     cd frontend ^&^& npm run build
REM     cd ..\backend ^&^& .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
REM Then open http://localhost:8000 (no :5173, no proxy).

cd /d "%~dp0backend"
start "stocks-backend" /min ".venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000

cd /d "%~dp0frontend"
start "stocks-frontend" /min cmd /c "npm run dev"

echo.
echo   Backend:  http://localhost:8000   (window titled "stocks-backend")
echo   Frontend: http://localhost:5173   (window titled "stocks-frontend")
echo.
echo   To stop: close those two minimized windows, or run  stop-dev.bat
