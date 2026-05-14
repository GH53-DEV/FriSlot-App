param(
  [int]$Port = 8081,
  [int]$MaxAttempts = 3
)

function Stop-PortListener {
  param([int]$ListenPort)

  $connections = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $processIds) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) {
      continue
    }

    Write-Host "Freeing port $ListenPort from $($proc.ProcessName) (PID $procId)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds 1
}

Stop-PortListener -ListenPort $Port

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  Write-Host "Starting Expo tunnel (attempt $attempt/$MaxAttempts)..."
  npx expo start --tunnel -c --port $Port
  if ($LASTEXITCODE -eq 0) {
    exit 0
  }
  Start-Sleep -Seconds 2
}

Write-Error "Tunnel failed after $MaxAttempts attempts. Use phone hotspot + npm run start:lan instead."
exit 1
