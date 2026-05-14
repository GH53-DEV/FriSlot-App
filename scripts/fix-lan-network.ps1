# Run in an elevated PowerShell if phone cannot open http://<lan-ip>:8081/status
param(
  [int]$Port = 8081
)

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  Write-Host "This script changes Windows Firewall rules and needs Administrator PowerShell."
  Write-Host "Right-click PowerShell -> Run as administrator, then run: npm run fix:lan"
}

$wifiProfile = Get-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue
if ($wifiProfile -and $wifiProfile.NetworkCategory -ne 'Private') {
  Write-Host "Setting Wi-Fi network category to Private..."
  try {
    Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private
  } catch {
    Write-Host "Could not set Wi-Fi to Private. Change it in Windows Settings -> Wi-Fi -> your network."
  }
}

function Add-FirewallRuleSafe {
  param(
    [string]$DisplayName,
    [scriptblock]$CreateRule
  )

  $existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue
  if ($existing) {
    return
  }

  try {
  & $CreateRule
  } catch {
    Write-Host "Could not add firewall rule '$DisplayName'. Access denied."
    Write-Host "Use Windows Security -> Firewall -> Allow an app, or run this script as administrator."
  }
}

Add-FirewallRuleSafe -DisplayName "Expo Metro TCP $Port" -CreateRule {
  Write-Host "Adding inbound firewall rule for TCP $Port..."
  New-NetFirewallRule -DisplayName "Expo Metro TCP $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Public
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodePath) {
  Add-FirewallRuleSafe -DisplayName 'Node.js Expo Dev' -CreateRule {
    Write-Host "Adding inbound firewall rule for Node.js..."
    New-NetFirewallRule -DisplayName 'Node.js Expo Dev' -Direction Inbound -Program $nodePath -Action Allow -Profile Private,Public
  }
}

Get-NetConnectionProfile -InterfaceAlias 'Wi-Fi' | Format-Table InterfaceAlias, NetworkCategory
Get-NetFirewallRule -DisplayName "Expo Metro TCP $Port", 'Node.js Expo Dev' -ErrorAction SilentlyContinue | Format-Table DisplayName, Enabled, Action
