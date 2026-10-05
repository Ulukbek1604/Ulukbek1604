@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Касса.lnk');" ^
  "$s.TargetPath=Join-Path $PSScriptRoot 'Касса.exe';" ^
  "$s.WorkingDirectory=$PSScriptRoot;" ^
  "$s.IconLocation=Join-Path $PSScriptRoot 'Касса.exe';" ^
  "$s.Description='Касса магазина телефонов и чехлов';" ^
  "$s.Save()"
echo Ярлык «Касса» создан на рабочем столе.
pause
