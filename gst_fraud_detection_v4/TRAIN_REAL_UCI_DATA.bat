@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo Ledger AI - Train on UCI Online Retail transaction data
echo ==========================================================
echo.

py -3.11 --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python 3.11 was not found.
  echo Install Python 3.11 64-bit from:
  echo https://www.python.org/downloads/release/python-3119/
  echo Then reopen this window and run this file again.
  pause
  exit /b 1
)

if not exist ".venv311\Scripts\python.exe" (
  echo Creating Python 3.11 virtual environment...
  py -3.11 -m venv .venv311
  if errorlevel 1 goto failed
)

echo Installing Python dependencies...
".venv311\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv311\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto failed

pushd backend
echo.
echo Downloading/checking the official UCI dataset...
"..\.venv311\Scripts\python.exe" data_pipeline.py
if errorlevel 1 (popd & goto failed)
echo.
echo Training and evaluating the Isolation Forest...
"..\.venv311\Scripts\python.exe" train_model.py
if errorlevel 1 (popd & goto failed)
popd

echo.
echo SUCCESS: Model, scaler and metrics were written to the models folder.
echo Dataset transactions are real; GST fields are synthetic mappings and test anomalies are planted for evaluation.
echo You can now double-click START_APP.bat to launch the dashboard.
pause
exit /b 0

:failed
echo.
echo SETUP/TRAINING FAILED. Copy the error shown above and share it for troubleshooting.
pause
exit /b 1
