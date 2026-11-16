$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $PSScriptRoot 'com.copygif.host.json'
$backupPath = Join-Path $PSScriptRoot 'previous-registration.json'
if (!(Test-Path -LiteralPath $backupPath)) { throw 'Registration backup is missing; no registry entries were changed.' }
$backups = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($backupPath))
foreach ($backup in $backups) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($backup.key, $true)
    if (!$key) { continue }
    try {
        if ($key.GetValue('') -ne $manifestPath) { continue }
        if ($null -ne $backup.previous) { $key.SetValue('', [string]$backup.previous) }
        else { $key.DeleteValue('', $false) }
    } finally { $key.Dispose() }
}
Write-Output 'Native host registration removed/restored. Remove Copy GIF from edge://extensions, then delete this portable folder if no longer needed.'
Write-Output 'GIF cache remains in %LOCALAPPDATA%\CopyGIF\Cache; delete it only after you no longer need to paste those files.'
