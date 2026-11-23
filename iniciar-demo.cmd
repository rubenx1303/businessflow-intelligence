@echo off
rem Arranca la demo de BusinessFlow Intelligence (todo local, sin Azure).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar-demo.ps1"
if errorlevel 1 pause
