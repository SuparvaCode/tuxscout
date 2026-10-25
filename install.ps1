# ==============================================================================
# TuxScout — Windows PowerShell One-Line Installer (install.ps1)
# Supports:
#   1. Remote via irm :  irm https://raw.githubusercontent.com/SuparvaCode/tuxscout/main/install.ps1 | iex
#   2. Local execution:  powershell -ExecutionPolicy Bypass -File .\install.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  TuxScout Installer for Windows (CLI + API + MCP + SDK)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Verify Node.js >= 18
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[1/5] Node.js not found. Installing Node.js LTS via winget..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } else {
        throw "Node.js >= 18 is required. Please install it from https://nodejs.org/"
    }
}
$nodeVer = & node -v
Write-Host "[1/5] Node.js detected: $nodeVer" -ForegroundColor Green

# 2. Check / Install ffmpeg (optional but recommended for MP3 extraction & 1080p+ muxing)
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "[2/5] Checking ffmpeg..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "      Tip: Run 'winget install -e --id Gyan.FFmpeg' anytime for MP3/1080p+ muxing." -ForegroundColor DarkGray
    }
} else {
    Write-Host "[2/5] ffmpeg detected in PATH." -ForegroundColor Green
}

# 3. Bootstrap standalone yt-dlp.exe into ~/.tuxscout/bin
$binDir = Join-Path $HOME ".tuxscout\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$ytDlpPath = Join-Path $binDir "yt-dlp.exe"

if (-not (Test-Path $ytDlpPath)) {
    Write-Host "[3/5] Downloading latest standalone yt-dlp.exe to $ytDlpPath ..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytDlpPath -UseBasicParsing
}
Write-Host "[3/5] yt-dlp ready at: $ytDlpPath" -ForegroundColor Green

# 4. Build & Global Install via npm install -g
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$pkgJson = Join-Path $scriptDir "package.json"

if (Test-Path $pkgJson) {
    Write-Host "[4/5] Building & installing TuxScout globally from $scriptDir ..." -ForegroundColor Cyan
    Push-Location $scriptDir
    try {
        & npm install
        & npm run build
        & npm install -g .
    } finally {
        Pop-Location
    }
} else {
    $repoUrl = if ($env:TUXSCOUT_GIT_URL) { $env:TUXSCOUT_GIT_URL } else { "git+https://github.com/SuparvaCode/tuxscout.git" }
    Write-Host "[4/5] Installing TuxScout globally from $repoUrl ..." -ForegroundColor Cyan
    & npm install -g $repoUrl
}

# 5. Run setup verification
Write-Host "[5/5] Verifying global TuxScout CLI commands..." -ForegroundColor Cyan
& tuxscout setup

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  TuxScout Installed Globally on Windows!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  Available commands in any PowerShell / CMD terminal:"
Write-Host "    tuxscout --help"
Write-Host "    tx-search `"Linux kernel 6.12`" -n 5"
Write-Host "    tx-images `"cyberpunk city`" --download --out .\images -n 3"
Write-Host "    tx-fetch https://example.com"
Write-Host "    tx-browser https://example.com --screenshot .\shot.png"
Write-Host "    tx-yt `"Me at the zoo`" --mode search -n 3"
Write-Host "    tx-research `"SQLite WAL mode concurrency`" --depth quick"
Write-Host "======================================================================" -ForegroundColor Green
