# AIPe installer (Windows PowerShell). Downloads the standalone `aipe.exe` and
# puts it on the PATH — no Bun/Node/npm required.
#
#   irm https://aipe.openvibes.tech/cli/install.ps1 | iex
#
# Env overrides: $env:AIPE_DOWNLOAD_BASE, $env:AIPE_INSTALL_DIR
$ErrorActionPreference = "Stop"

$base = if ($env:AIPE_DOWNLOAD_BASE) { $env:AIPE_DOWNLOAD_BASE } else { "https://aipe.openvibes.tech/cli" }
$installDir = if ($env:AIPE_INSTALL_DIR) { $env:AIPE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "aipe\bin" }

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x64" }
$label = "windows-$arch"
$url = "$base/aipe-$label.exe"

Write-Host "aipe: installing $label from $url"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir "aipe.exe"
Invoke-WebRequest -Uri $url -OutFile $target

Write-Host "aipe: installed to $target"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
  Write-Host "aipe: added $installDir to your user PATH (restart the shell to pick it up)"
}
Write-Host "aipe: run 'aipe start' in your project folder to set up a workspace."
