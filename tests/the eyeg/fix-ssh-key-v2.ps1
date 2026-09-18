$keyPath = "C:\Users\Hammad\Desktop\the eyeg\the-eye-key.pem"
$tempPath = "C:\Users\Hammad\AppData\Local\Temp\ssh-key.pem"

# Copy file
Copy-Item $keyPath $tempPath -Force

# Remove inheritance
$acl = Get-Acl $tempPath
$acl.SetAccessRuleProtection($true, $false)

# Remove all existing access rules
$acl.Access | ForEach-Object { 
    try { $acl.RemoveAccessRule($_) } catch {}
}

# Add only current user with full control
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, "FullControl", "Allow")
$acl.SetAccessRule($rule)

# Apply
Set-Acl $tempPath $acl

Write-Host "Key copied to: $tempPath"
Write-Host "Permissions set for: $currentUser"
