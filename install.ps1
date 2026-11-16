param(
    [string]$Version = '1.2.0',
    [string]$InstallDirectory = 'C:\Program Files (Portable)\Copy GIF',
    [ValidateSet('All', 'Edge', 'Chrome', 'Chromium', 'Brave', 'Vivaldi', 'Opera', 'Both')][string]$Browser = 'All'
)
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitOperatingSystem) { throw 'Copy GIF requires 64-bit Windows.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('copy-gif-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $base = "https://github.com/hollen9/copy-gif/releases/download/v$Version"
    $archive = Join-Path $work 'copy-gif-win-x64.zip'
    Invoke-WebRequest "$base/copy-gif-win-x64.zip" -OutFile $archive -UseBasicParsing
    $checksums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
    if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
    $match = [regex]::Match([string]$checksums, '(?m)^([a-fA-F0-9]{64})\s+copy-gif-win-x64\.zip\s*$')
    if (!$match.Success -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) {
        throw 'Package checksum mismatch.'
    }
    $package = Join-Path $work 'package'
    Expand-Archive -LiteralPath $archive -DestinationPath $package
    & (Join-Path $package 'install-windows.ps1') -InstallDirectory $InstallDirectory -Browser $Browser
} finally {
    $resolved = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
