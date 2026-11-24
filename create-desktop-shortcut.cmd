@echo off
rem Creates an "IJOS" shortcut on the desktop that starts the app minimized.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\IJOS.lnk');" ^
  "$s.TargetPath='%~dp0start-ijos.cmd'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0public\favicon.ico'; $s.WindowStyle=7; $s.Save()"
echo Shortcut created on the desktop.
pause
