$keyPath = "C:\Users\Hammad\Downloads\the-eye-key..pem"
$tempPath = "C:\Users\Hammad\AppData\Local\Temp\ssh-key.pem"

# Copy file using cmd to bypass permission issues
cmd /c "copy `"$keyPath`" `"$tempPath`"" | Out-Null

# Remove inheritance
$acl = Get-Acl $tempPath
$acl.SetAccessRuleProtection($true, $false)

# Get current user
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# Remove all access rules except current user
$acl.Access | ForEach-Object {
    if ($_.IdentityReference.Value -ne $currentUser -and $_.IdentityReference.Value -ne "NT AUTHORITY\SYSTEM" -and $_.IdentityReference.Value -ne "BUILTIN\Administrators") {
        try { $acl.RemoveAccessRule($_) } catch {}
    }
}

# Ensure current user has full control
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, "FullControl", "Allow")
$acl.SetAccessRule($rule)

# Apply using cmd to bypass privilege issues
try {
    Set-Acl $tempPath $acl
    Write-Host "SUCCESS: Key copied and permissions set"
    Write-Host "Location: $tempPath"
} catch {
    Write-Host "FAILED: $_"
}
