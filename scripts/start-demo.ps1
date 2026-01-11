# Start all services for demo
# API server, office-dashboard, 2 employee registers, cleaning station

Write-Host "Starting demo services..." -ForegroundColor Cyan

# Ensure we run from repo root (this script lives in /scripts)
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Seeding demo data (pnpm demo:seed)..." -ForegroundColor Cyan
pnpm demo:seed

# Start API server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd services/api; `$env:DEMO_MODE='true'; pnpm dev" -WindowStyle Minimized

Start-Sleep -Seconds 3

# Start office-dashboard
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/office-dashboard; pnpm dev" -WindowStyle Minimized

Start-Sleep -Seconds 2

# Start employee-register Lane 1
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/employee-register; `$env:VITE_LANE='1'; pnpm dev" -WindowStyle Minimized

Start-Sleep -Seconds 2

# Start employee-register Lane 2 (different port)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/employee-register; `$env:VITE_LANE='2'; vite --port 5177 --strictPort" -WindowStyle Minimized

Start-Sleep -Seconds 2

# Start cleaning-station-kiosk
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/cleaning-station-kiosk; pnpm dev" -WindowStyle Minimized

Write-Host "`nAll services starting..." -ForegroundColor Green
Write-Host "  - API: http://localhost:3001" -ForegroundColor Yellow
Write-Host "  - Office Dashboard: http://localhost:5176" -ForegroundColor Yellow
Write-Host "  - Employee Register Lane 1: http://localhost:5175" -ForegroundColor Yellow
Write-Host "  - Employee Register Lane 2: http://localhost:5177" -ForegroundColor Yellow
Write-Host "  - Cleaning Station: http://localhost:5174" -ForegroundColor Yellow
Write-Host "`nWaiting for services to start..." -ForegroundColor Cyan





