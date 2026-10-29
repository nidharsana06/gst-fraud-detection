@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv311\Scripts\python.exe" (
  echo Python environment not found. First run TRAIN_REAL_UCI_DATA.bat.
  pause
  exit /b 1
)
cd backend
"..\.venv311\Scripts\python.exe" -m uvicorn main:app --reload --port 8000
pause
