param(
    [string]$Version = 'latest',
    [ValidateNotNullOrEmpty()][string]$ExtensionDirectory = 'C:\Program Files (Portable)\Copy GIF\Extension',
    [string]$Package
)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ('copy-gif-extension-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    if (!$Package) {
        $base = 'https://github.com/hollen9/copy-gif/releases'
        if ($Version -eq 'latest') { $base += '/latest/download' }
        elseif ($Version -match '^v?\d+\.\d+\.\d+$') { $base += '/download/v' + $Version.TrimStart('v') }
        else { throw 'Version must be latest or a release number such as 1.3.1.' }
        $Package = Join-Path $work 'copy-gif-extension.zip'
        Invoke-WebRequest "$base/copy-gif-extension.zip" -OutFile $Package -UseBasicParsing
        $checksums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
        if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
        $match = [regex]::Match([string]$checksums, '(?m)^([a-fA-F0-9]{64})\s+copy-gif-extension\.zip\s*$')
        if (!$match.Success -or (Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash -ne $match.Groups[1].Value) {
            throw 'Package checksum mismatch.'
        }
    }
    $source = Join-Path $work 'package'
    Expand-Archive -LiteralPath $Package -DestinationPath $source
    $required = @('manifest.json', 'background.js', 'content.js', 'gif-video.js', 'twitter-context.js',
        'diagnostics.html', 'diagnostics.js', 'vendor/gifenc.js', 'vendor/gifenc.LICENSE.txt',
        'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png')
    foreach ($name in $required) {
        if (!(Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) { throw "Invalid extension package: missing $name" }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'Copy GIF' -or $manifest.manifest_version -ne 3 -or !$manifest.key) { throw 'Invalid Copy GIF extension manifest.' }
    $ExtensionDirectory = [IO.Path]::GetFullPath($ExtensionDirectory)
    $currentManifest = Join-Path $ExtensionDirectory 'manifest.json'
    if (Test-Path -LiteralPath $ExtensionDirectory) {
        if (Test-Path -LiteralPath $currentManifest -PathType Leaf) {
            $current = Get-Content -LiteralPath $currentManifest -Raw | ConvertFrom-Json
            if ($current.name -ne 'Copy GIF' -or $current.key -ne $manifest.key) { throw 'The target contains a different extension.' }
        } elseif (@(Get-ChildItem -LiteralPath $ExtensionDirectory -Force).Count) {
            throw 'The target is not an empty folder or an existing Copy GIF extension.'
        }
    }
    New-Item -ItemType Directory -Path $ExtensionDirectory -Force | Out-Null
    # Write the manifest last; the browser loads the update when it is reloaded.
    foreach ($name in $required | Where-Object { $_ -ne 'manifest.json' }) {
        $target = Join-Path $ExtensionDirectory $name
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target -Force
    }
    Copy-Item -LiteralPath (Join-Path $source 'manifest.json') -Destination $currentManifest -Force
    Write-Host "Copy GIF extension $($manifest.version): $ExtensionDirectory"
    Write-Host 'Open chrome://extensions and load this folder, or reload the existing extension. Refresh open pages.'
    Write-Host 'GIF copying also requires the native host from the full installer.'
} finally {
    $resolved = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^copy-gif-extension-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
