# Lets the portal app send mail ONLY from its two shared mailboxes, using RBAC for Applications in Exchange Online.
# https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
#
# Run after setup-microsoft.mjs, signed in as an Exchange administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-mail.ps1
# Safe to run again: existing items are kept. Never grant Mail.Send to this app in Entra:
# consents are additive, so that would allow sending from every mailbox in the tenant.

$ErrorActionPreference = 'Stop'
$AppId = 'cd4ae5dd-43c4-4de0-8565-e40b7fd7edd8'
$DisplayName = 'BULADMIN Portal'
$ScopeName = 'BULADMIN Portal Mailboxes'
$Marker = 'BuladminPortalMail'
$Mailboxes = @(
  @{ Address = 'no-reply@portal.buladmin.eu'; Alias = 'portal-no-reply'; Name = 'BULADMIN Portal No-Reply' },
  @{ Address = 'accounts@portal.buladmin.eu'; Alias = 'portal-accounts'; Name = 'BULADMIN Portal Accounts' }
)

$ObjectId = (Get-Content (Join-Path $PSScriptRoot '..\.secrets\service-principal-id.txt') -Raw).Trim()

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
}
Import-Module ExchangeOnlineManagement
# -DisableWAM signs in through the browser, so this also works without a console window.
Connect-ExchangeOnline -ShowBanner:$false -DisableWAM

foreach ($mailbox in $Mailboxes) {
  $existing = Get-Mailbox -Identity $mailbox.Address -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Mailbox exists: $($mailbox.Address)"
  } else {
    New-Mailbox -Shared -Name $mailbox.Name -DisplayName 'BULADMIN' -Alias $mailbox.Alias -PrimarySmtpAddress $mailbox.Address | Out-Null
    Write-Host "Mailbox created: $($mailbox.Address)"
  }
  Set-Mailbox -Identity $mailbox.Address -CustomAttribute15 $Marker
}

if (-not (Get-ServicePrincipal -Identity $ObjectId -ErrorAction SilentlyContinue)) {
  New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName $DisplayName | Out-Null
}
if (-not (Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue)) {
  New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "CustomAttribute15 -eq '$Marker'" | Out-Null
}
$assignment = Get-ManagementRoleAssignment -Role 'Application Mail.Send' -ErrorAction SilentlyContinue |
  Where-Object { $_.CustomResourceScope -eq $ScopeName }
if (-not $assignment) {
  New-ManagementRoleAssignment -App $ObjectId -Role 'Application Mail.Send' -CustomResourceScope $ScopeName | Out-Null
}

# InScope must be True for the two portal mailboxes and False for your own mailbox.
Write-Host ''
$me = (Get-ConnectionInformation | Select-Object -First 1).UserPrincipalName
foreach ($resource in @(($Mailboxes | ForEach-Object { $_.Address }) + $me)) {
  $result = Test-ServicePrincipalAuthorization -Identity $ObjectId -Resource $resource |
    Where-Object { $_.RoleName -eq 'Application Mail.Send' }
  Write-Host "$resource InScope=$($result.InScope)"
}
Disconnect-ExchangeOnline -Confirm:$false
Write-Host 'DONE. Exchange may take 30 minutes to 2 hours to apply this.'
