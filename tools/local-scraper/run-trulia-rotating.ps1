# Resolve Node before starting any scraping work.
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$scraperNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $scraperNode) {
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
  )) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $scraperNode = $candidate
      break
    }
  }
}
if (-not $scraperNode) {
  throw 'Node.js was not found. Install Node.js or add node.exe to PATH before running this scraper.'
}

Set-Location "C:\Users\jared\scraper"
& $scraperNode .\verify-scraper.cjs
if ($LASTEXITCODE -ne 0) { throw "Scraper integrity check failed; no scraping was started." }

$env:SUPABASE_URL="https://nicanqrfqlbnlmnoernb.supabase.co"

$env:LIMIT="20"
$env:HEADLESS="false"
$env:CHROME_USER_DATA_DIR="C:\chrome-profile"
$env:CONNECT_TO_EXISTING_CHROME="true"
$env:CHROME_DEBUG_URL="http://127.0.0.1:9222"

# Skip rows already attempted/scraped
$env:SKIP_AGENT_SCRAPED="true"
$env:SKIP_EXISTING_LISTING_AGENTS="true"
$env:MARK_NO_DATA_ATTEMPTS="true"


# Load persistent, per-user phone approval settings when configured.
foreach ($name in @(
  "TRULIA_PHONE_APPROVAL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_APPROVER_USER_ID",
  "TRULIA_APPROVAL_TIMEOUT_SECONDS",
  "TRULIA_HOLD_MS",
  "TRULIA_VERIFY_SETTLE_SECONDS"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    Set-Item -Path "Env:$name" -Value $value
  }
}
# Auto mode: phone approval handles verification when configured; otherwise stop.
$env:MANUAL_VERIFY="false"

$areas = @(
  @{ Name="Oceanside"; Lat="40.63871"; Lng="-73.64013"; Radius="15" },
  @{ Name="Melville"; Lat="40.79343"; Lng="-73.41512"; Radius="15" },
  @{ Name="Shirley"; Lat="40.80149"; Lng="-72.86705"; Radius="18" },
  @{ Name="GreatNeck"; Lat="40.80066"; Lng="-73.72846"; Radius="12" },
  @{ Name="Ronkonkoma"; Lat="40.81538"; Lng="-73.11233"; Radius="15" },
  @{ Name="Huntington"; Lat="40.86815"; Lng="-73.42568"; Radius="15" },
  @{ Name="Brooklyn"; Lat="40.6782"; Lng="-73.9442"; Radius="15" }
)

if (!(Test-Path ".\logs")) {
  New-Item -ItemType Directory -Path ".\logs" | Out-Null
}

foreach ($area in $areas) {
  $env:CENTER_LAT=$area.Lat
  $env:CENTER_LNG=$area.Lng
  $env:RADIUS_MILES=$area.Radius

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $log = ".\logs\trulia-$($area.Name)-$stamp.log"

  Write-Host "======================================"
  Write-Host "Running area: $($area.Name)"
  Write-Host "Center: $($area.Lat), $($area.Lng)"
  Write-Host "Radius: $($area.Radius) miles"
  Write-Host "Log: $log"
  Write-Host "======================================"

  & $scraperNode .\trulia-old-working-plus-patch.cjs *> $log
  $nodeExitCode = $LASTEXITCODE

  if ($nodeExitCode -eq 42) {
    Write-Warning "Trulia verification was not approved or could not be cleared. Stopping rotation."
    break
  }

  if ($nodeExitCode -ne 0) {
    Write-Warning "Trulia worker exited with code $nodeExitCode. See $log"
  }


}
