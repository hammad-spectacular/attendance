$keyPath = "C:\Users\Hammad\Desktop\the eyeg\the-eye-key.pem"
$tempPath = "C:\Users\Hammad\AppData\Local\Temp\the-eye-key-frontend.pem"

# Copy to temp
Copy-Item $keyPath $tempPath -Force

# Remove all permissions
$acl = Get-Acl $tempPath
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) }
Set-Acl $tempPath $acl

# Add only current user
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
$acl.SetAccessRule($rule)
Set-Acl $tempPath $acl

Write-Host "Permissions fixed"
