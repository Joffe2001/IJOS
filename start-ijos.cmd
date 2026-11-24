@echo off
chcp 65001 >nul
title IJOS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  echo Node.js לא מותקן. התקינו את גרסת LTS מ-https://nodejs.org והפעילו שוב את הקובץ.
  pause
  exit /b 1
)
node --disable-warning=ExperimentalWarning server.js --open
if errorlevel 1 pause
