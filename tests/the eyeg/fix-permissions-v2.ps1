$file = 'the-eye-key.pem'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = Get-Acl $file
$acl.SetAccessRuleProtection($true, $true)
$acl.SetOwner([System.Security.Principal.NTAccount]$user)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'FullControl', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl $file $acl
Write-Host "Permissions reset to $user only"
