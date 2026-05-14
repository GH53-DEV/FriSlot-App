param(
  [int]$Port = 8081
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

$wifiAddress = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.InterfaceAlias -like '*Wi-Fi*' -and
    $_.IPAddress -notlike '169.254.*'
  } |
  Select-Object -First 1

if (-not $wifiAddress) {
  Write-Error 'No Wi-Fi IPv4 address found. Connect to Wi-Fi and run npm run start:lan again.'
  exit 1
}

Stop-PortListener -ListenPort $Port

$wifiProfile = Get-NetConnectionProfile -InterfaceAlias $wifiAddress.InterfaceAlias -ErrorAction SilentlyContinue
if ($wifiProfile -and $wifiProfile.NetworkCategory -eq 'Public') {
  Write-Host "WARNING: Wi-Fi is Public. Phone LAN access may be blocked by Windows Firewall."
  Write-Host "Set this Wi-Fi to Private, or run scripts/fix-lan-network.ps1 in elevated PowerShell."
}

$ip = $wifiAddress.IPAddress
Write-Host "Expo LAN: $($wifiAddress.InterfaceAlias) -> $ip"
Write-Host "Phone check (same Wi-Fi): http://$ip`:$Port/status"
Write-Host "Paste that URL in the browser bar. Use ASCII ':' (half-width), not full-width."
Write-Host "Expected text: packager-status:running"
Write-Host "If phone cannot open it, fix Wi-Fi/firewall before scanning Expo Go."
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
npx expo start --lan -c --port $Port @args
