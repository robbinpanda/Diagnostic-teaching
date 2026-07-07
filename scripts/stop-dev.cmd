@echo off
title ai4edu-stop
setlocal
chcp 65001 >nul
echo Stopping diagnostic math tutor MVP...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(3000,8010); " ^
  "$pids = foreach ($port in $ports) { " ^
  "  netstat -ano | Select-String (':' + $port + '\s') | ForEach-Object { " ^
  "    $parts = ($_ -split '\s+') | Where-Object { $_ }; " ^
  "    if ($parts.Length -ge 5 -and $parts[3] -eq 'LISTENING') { [int]$parts[4] } " ^
  "  } " ^
  "}; " ^
  "$pids = $pids | Sort-Object -Unique; " ^
  "if (-not $pids) { Write-Host 'No services found on ports 3000 or 8010.'; exit 0 }; " ^
  "foreach ($pidValue in $pids) { " ^
  "  try { Stop-Process -Id $pidValue -Force; Write-Host ('Stopped PID ' + $pidValue) } " ^
  "  catch { Write-Host ('Could not stop PID ' + $pidValue + ': ' + $_.Exception.Message) } " ^
  "}"
echo.
echo Done.
pause
