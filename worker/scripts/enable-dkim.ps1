# Signs outgoing portal mail with portal.buladmin.eu instead of the tenant's onmicrosoft.com domain.
# Run signed in as an Exchange administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\enable-dkim.ps1
# Safe to run again. The selector CNAME records must already exist in DNS.

$ErrorActionPreference = 'Stop'
$Domain = 'portal.buladmin.eu'

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
}
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -ShowBanner:$false -DisableWAM

# Get-DkimSigningConfig -Identity can return a placeholder for a domain that has no configuration,
# so the result of Set decides whether a new configuration is needed.
try {
  Set-DkimSigningConfig -Identity $Domain -Enabled $true -ErrorAction Stop
} catch {
  Write-Host "No DKIM configuration yet for $Domain; creating one."
  New-DkimSigningConfig -DomainName $Domain -Enabled $true -ErrorAction Stop | Out-Null
}

Get-DkimSigningConfig -Identity $Domain | ForEach-Object {
  Write-Host "Domain=$($_.Domain) Enabled=$($_.Enabled) Status=$($_.Status)"
  Write-Host "Selector1=$($_.Selector1CNAME)"
  Write-Host "Selector2=$($_.Selector2CNAME)"
}
Disconnect-ExchangeOnline -Confirm:$false
Write-Host 'DONE'
