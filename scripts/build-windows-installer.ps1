[CmdletBinding()]
param(
    [string]$NodePath = "",
    [string]$PythonPath = "",
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$apiDirectory = Join-Path $repoRoot "apps\api"
$desktopDirectory = Join-Path $repoRoot "apps\desktop"
$webDirectory = Join-Path $repoRoot "apps\web"
$buildDirectory = Join-Path $repoRoot ".build"
$pythonEnvironment = Join-Path $buildDirectory "windows-python"
$windowsDist = Join-Path $repoRoot "dist\windows"

function Resolve-Executable([string]$ExplicitPath, [string]$CommandName) {
    if ($ExplicitPath) {
        $resolved = (Resolve-Path -LiteralPath $ExplicitPath).Path
        return $resolved
    }
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "Cannot find $CommandName. Install it or pass an explicit executable path."
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
    }
}

function Remove-BuildOutput([string]$TargetPath) {
    $fullTarget = [System.IO.Path]::GetFullPath($TargetPath)
    $allowedPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullTarget.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a path outside the workspace: $fullTarget"
    }
    if (Test-Path -LiteralPath $fullTarget) {
        Remove-Item -LiteralPath $fullTarget -Recurse -Force
    }
}

$node = Resolve-Executable $NodePath "node"
$bootstrapPython = Resolve-Executable $PythonPath "python"

New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null
if (-not $env:ELECTRON_BUILDER_CACHE) {
    $env:ELECTRON_BUILDER_CACHE = Join-Path $buildDirectory "electron-builder-cache"
}
New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $pythonEnvironment "Scripts\python.exe"))) {
    Invoke-Checked $bootstrapPython @("-m", "venv", $pythonEnvironment)
}
$buildPython = Join-Path $pythonEnvironment "Scripts\python.exe"

if (-not $SkipDependencyInstall) {
    Invoke-Checked $buildPython @(
        (Join-Path $repoRoot "scripts\install-python-deps.py"), "build"
    )
}

if (-not (Test-Path -LiteralPath (Join-Path $webDirectory "node_modules\next\dist\bin\next"))) {
    if ($SkipDependencyInstall) {
        throw "apps/web/node_modules is missing while SkipDependencyInstall is set."
    }
    $npm = Resolve-Executable "" "npm.cmd"
    Push-Location $webDirectory
    try {
        Invoke-Checked $npm @("ci")
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $desktopDirectory "node_modules\electron-builder\out\cli\cli.js"))) {
    if ($SkipDependencyInstall) {
        throw "apps/desktop/node_modules is missing while SkipDependencyInstall is set."
    }
    $pnpm = Resolve-Executable "" "pnpm.cmd"
    Invoke-Checked $pnpm @("--dir", $desktopDirectory, "install", "--frozen-lockfile")
}

$electronExecutable = Join-Path $desktopDirectory "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electronExecutable)) {
    if ($SkipDependencyInstall) {
        throw "The Electron runtime is missing while SkipDependencyInstall is set."
    }
    Invoke-Checked $node @((Join-Path $desktopDirectory "node_modules\electron\install.js"))
}

Remove-BuildOutput (Join-Path $windowsDist "api")
Remove-BuildOutput (Join-Path $windowsDist "installer")
Remove-BuildOutput (Join-Path $buildDirectory "pyinstaller")

Write-Host "[1/3] Building the static web app..."
Push-Location $webDirectory
try {
    Invoke-Checked $node @((Join-Path $webDirectory "node_modules\next\dist\bin\next"), "build")
    Invoke-Checked $node @((Join-Path $webDirectory "scripts\inject-design-contract.mjs"))
}
finally {
    Pop-Location
}

$webIndex = Join-Path $webDirectory "out\index.html"
if (-not (Test-Path -LiteralPath $webIndex)) {
    throw "Next.js did not produce the static export: $webIndex"
}

Write-Host "[2/3] Packaging the FastAPI sidecar..."
Invoke-Checked $buildPython @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--distpath", $windowsDist,
    "--workpath", (Join-Path $buildDirectory "pyinstaller"),
    (Join-Path $desktopDirectory "diagnostic-teaching-api.spec")
)

$apiExecutable = Join-Path $windowsDist "api\diagnostic-teaching-api.exe"
if (-not (Test-Path -LiteralPath $apiExecutable)) {
    throw "PyInstaller did not produce the FastAPI sidecar: $apiExecutable"
}

Write-Host "[3/3] Building the Windows NSIS installer..."
Push-Location $desktopDirectory
try {
    Invoke-Checked $node @(
        (Join-Path $desktopDirectory "node_modules\electron-builder\out\cli\cli.js"),
        "--win", "nsis", "--x64", "--config", "electron-builder.yml"
    )
}
finally {
    Pop-Location
}

$installers = @(Get-ChildItem -LiteralPath (Join-Path $windowsDist "installer") -Filter "*.exe")
if ($installers.Count -eq 0) {
    throw "electron-builder did not produce an installer."
}

Write-Host "Build complete:"
$installers | ForEach-Object { Write-Host $_.FullName }
