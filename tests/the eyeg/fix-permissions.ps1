$acl = Get-Acl 'the-eye-key.pem'
$acl.SetAccessRuleProtection($true, $false)
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl.Access | Where-Object { $_.IdentityReference -notlike "*$user*" } | ForEach-Object { $acl.RemoveAccessRule($_) }
Set-Acl 'the-eye-key.pem' $acl
Write-Host "Permissions fixed"
