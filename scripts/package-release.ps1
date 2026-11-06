# scripts/package-release.ps1
# Packages the Sahayak Chrome extension into a production-ready ZIP archive
# with manifest.json at the archive root.

[CmdletBinding()]
param(
  [string]$OutputFile = "sahayak-extension.zip"
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$TargetPath = Join-Path $RootDir $OutputFile

Write-Host "==> Packaging Sahayak Extension..." -ForegroundColor Cyan
Write-Host "    Source: $RootDir"
Write-Host "    Target: $TargetPath"

# Temporary directory for clean staging
$StagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("sahayak-stage-" + [System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

try {
  # Extension core folders & files to include in release
  $IncludeItems = @(
    "manifest.json",
    "LICENSE",
    "README.md",
    "assets",
    "background",
    "content",
    "lib",
    "options",
    "pages",
    "sidepanel"
  )

  foreach ($item in $IncludeItems) {
    $src = Join-Path $RootDir $item
    if (Test-Path $src) {
      $dest = Join-Path $StagingDir $item
      Copy-Item -Path $src -Destination $dest -Recurse -Force
      Write-Host "    [+] Included: $item" -ForegroundColor Green
    } else {
      Write-Warning "    [-] Missing expected file/dir: $item"
    }
  }

  # Ensure manifest.json is at the staging root
  $ManifestCheck = Join-Path $StagingDir "manifest.json"
  if (-not (Test-Path $ManifestCheck)) {
    throw "Critical: manifest.json is missing from staging root!"
  }

  # Remove any temporary or sensitive patterns from staging if present
  Get-ChildItem -Path $StagingDir -Recurse -Include "*.git*", "*.env*", "*.tmp", "*.log", ".DS_Store" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  # Remove previous zip if exists
  if (Test-Path $TargetPath) {
    Remove-Item $TargetPath -Force
  }

  # Compress staging directory contents to archive
  Compress-Archive -Path "$StagingDir\*" -DestinationPath $TargetPath -CompressionLevel Optimal

  # Copy to pages directory for direct 1-click landing page download
  $PagesZipPath = Join-Path $RootDir "pages\sahayak-extension.zip"
  Copy-Item -Path $TargetPath -Destination $PagesZipPath -Force

  $ZipItem = Get-Item $TargetPath
  $SizeKb = [math]::Round($ZipItem.Length / 1024, 2)
  Write-Host "==> Success! Release package created:" -ForegroundColor Green
  Write-Host "    Archive: $TargetPath ($SizeKb KB)"
  Write-Host "    Landing Download: $PagesZipPath"
  Write-Host "    Manifest at root: verified."
}
finally {
  if (Test-Path $StagingDir) {
    Remove-Item -Path $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

