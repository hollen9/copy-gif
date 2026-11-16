param(
    [string]$InstallDirectory = 'C:\Program Files (Portable)\Copy GIF',
    [ValidateSet('All', 'Edge', 'Chrome', 'Chromium', 'Brave', 'Vivaldi', 'Opera', 'Both')][string]$Browser = 'All'
)
$ErrorActionPreference = 'Stop'
$sourceDirectory = $PSScriptRoot
$executable = Join-Path $sourceDirectory 'native-host\windows\publish\copy-gif-host.exe'
if (!(Test-Path -LiteralPath $executable)) { $executable = Join-Path $sourceDirectory 'copy-gif-host.exe' }
if (!(Test-Path -LiteralPath $executable)) {
    throw 'Build first: dotnet publish native-host\windows\CopyGif.Host.csproj -c Release -o native-host\windows\publish'
}
$manifest = Get-Content -LiteralPath (Join-Path $sourceDirectory 'manifest.json') -Raw | ConvertFrom-Json
if (!$manifest.key) { throw 'The extension manifest must have its stable public key.' }
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash([Convert]::FromBase64String($manifest.key)) } finally { $sha.Dispose() }
$extensionId = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$extensionDirectory = Join-Path $InstallDirectory 'Extension'
New-Item -ItemType Directory -Path $extensionDirectory -Force | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $InstallDirectory 'copy-gif-host.exe') -Force
foreach ($name in @('manifest.json', 'background.js', 'content.js', 'diagnostics.html', 'diagnostics.js')) {
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $name) -Destination $extensionDirectory -Force
}
New-Item -ItemType Directory -Path (Join-Path $extensionDirectory 'icons') -Force | Out-Null
foreach ($name in @('icon16.png', 'icon48.png', 'icon128.png')) {
    Copy-Item -LiteralPath (Join-Path $sourceDirectory "icons\$name") -Destination (Join-Path $extensionDirectory 'icons') -Force
}
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'WINDOWS.md') -Destination (Join-Path $InstallDirectory 'README.md') -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'uninstall-windows.ps1') -Destination $InstallDirectory -Force
$hostManifestPath = Join-Path $InstallDirectory 'com.copygif.host.json'
$hostManifest = [ordered]@{
    name = 'com.copygif.host'
    description = 'Copy GIF Windows Native Messaging Host (.NET WPF)'
    path = Join-Path $InstallDirectory 'copy-gif-host.exe'
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
# Windows PowerShell 5.1's -Encoding UTF8 emits a BOM. Use explicit UTF-8
# without BOM so the manifest also works when this script is run from the BAT.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($hostManifestPath, ($hostManifest | ConvertTo-Json -Depth 5), $utf8NoBom)
$registrations = @()
if ($Browser -in @('All', 'Edge', 'Both')) { $registrations += 'Software\Microsoft\Edge\NativeMessagingHosts\com.copygif.host' }
# Edge supports the Chrome registry location as a fallback. Register both for
# Edge: some existing Edge profiles only discover this host via that location.
if ($Browser -in @('All', 'Edge', 'Chrome', 'Chromium', 'Brave', 'Vivaldi', 'Opera', 'Both')) { $registrations += 'Software\Google\Chrome\NativeMessagingHosts\com.copygif.host' }
if ($Browser -in @('All', 'Chromium')) { $registrations += 'Software\Chromium\NativeMessagingHosts\com.copygif.host' }
if ($Browser -in @('All', 'Brave')) { $registrations += 'Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.copygif.host' }
if ($Browser -in @('All', 'Vivaldi')) { $registrations += 'Software\Vivaldi\NativeMessagingHosts\com.copygif.host' }
$backupPath = Join-Path $InstallDirectory 'previous-registration.json'
$backups = @()
if (Test-Path -LiteralPath $backupPath) {
    $savedBackups = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($backupPath))
    foreach ($savedEntry in $savedBackups) {
        # Recover the value/Count wrapper produced by older installers on PS 5.1.
        $entries = if ($savedEntry.PSObject.Properties['key']) { @($savedEntry) }
                   elseif ($savedEntry.PSObject.Properties['value']) { @($savedEntry.value) }
                   else { throw 'Invalid registration backup; refusing to overwrite it.' }
        foreach ($entry in $entries) {
            if (!$entry.key -or !$entry.PSObject.Properties['previous']) { throw 'Invalid registration backup entry.' }
            # Reconstruct plain objects: PS 5.1 can attach array metadata to parsed
            # JSON arrays, which must not be serialized into the rollback file.
            $backups += [pscustomobject]@{ key = [string]$entry.key; previous = $entry.previous }
        }
    }
}
foreach ($registration in $registrations) {
    $existingKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registration)
    $oldValue = if ($existingKey) { $existingKey.GetValue('') } else { $null }
    if ($existingKey) { $existingKey.Dispose() }
    if (!($backups | Where-Object { $_.key -eq $registration })) {
        $backups += [pscustomobject]@{ key = $registration; previous = $oldValue }
    }
    # Save rollback information before changing this user's registration.
    [IO.File]::WriteAllText($backupPath, (ConvertTo-Json -InputObject @($backups) -Depth 5), $utf8NoBom)
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registration)
    try { $key.SetValue('', $hostManifestPath, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
}
Write-Output "Installed native host: $InstallDirectory"
Write-Output "Load unpacked extension: $extensionDirectory"
Write-Output "Extension ID: $extensionId"
