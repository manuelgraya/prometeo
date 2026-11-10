@echo off
rem prometeo: lanzador para Windows (en Linux y macOS, bin/prometeo).
rem Toda la logica esta en prometeo.py; uv lo ejecuta sin necesitar Python instalado.
where uv >nul 2>nul
if errorlevel 1 (
  echo Falta uv en el PATH. Para instalarlo: 1>&2
  echo   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" 1>&2
  exit /b 1
)
uv run --quiet --script "%~dp0prometeo.py" %*
