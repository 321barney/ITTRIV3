#requires -Version 5.1
Param(
  [int]$RedisPort = 6379,
  [string]$BackendDir = $(if ($env:BACKEND_DIR) { $env:BACKEND_DIR } else { "backend" }),
  [string]$FrontendDir = $(if ($env:FRONTEND_DIR) { $env:FRONTEND_DIR } else { "ittri-frontend" }),
  [string]$RedisDataDir = $(if ($env:REDIS_DATA_DIR) { $env:REDIS_DATA_DIR } else { ".redisdata" })
)

# Env load order: .env -> .env.development -> .env.local
function Load-EnvFile($path) {
  if (Test-Path $path) {
    Get-Content $path | ForEach-Object {
      if ($_ -match '^[A-Za-z_][A-Za-z0-9_]*=') {
        $kv = $_.Split('=',2); if ($kv.Length -eq 2) { [Environment]::SetEnvironmentVariable($kv[0], $kv[1]) }
      }
    }
  }
}
Load-EnvFile ".env"
Load-EnvFile ".env.development"
Load-EnvFile ".env.local"

$DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "" }
if (-not $DATABASE_URL) { Write-Error "DATABASE_URL is not set."; exit 1 }

function Need-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Write-Error "Missing command: $name"; exit 1 }
}

Need-Cmd node
Need-Cmd npm

function Use-DockerCompose { (Get-Command docker -ErrorAction SilentlyContinue) -and ((docker compose version) -ne $null) }

Write-Host "==> Ensuring Redis is up (port $RedisPort)"
$redisRunning = $false
if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
  try { $pong = & redis-cli -p $RedisPort ping 2>$null; if ($pong -eq "PONG") { $redisRunning = $true } } catch {}
}
if (-not $redisRunning) {
  if (Use-DockerCompose) {
    Write-Host "    Using Docker Compose (if 'redis' service exists)."
    try { docker compose up -d redis | Out-Null } catch {}
    if (-not $redisRunning) {
      Write-Host "    Spawning standalone Redis container..."
      try { docker rm -f ittri-redis | Out-Null } catch {}
      docker run -d --name ittri-redis -p "${RedisPort}:6379" -v "${PWD}\${RedisDataDir}:/data" redis:7-alpine redis-server --appendonly yes | Out-Null
      Start-Sleep -Milliseconds 800
    }
  } else {
    Need-Cmd redis-server
    Need-Cmd redis-cli
    if (-not (Test-Path $RedisDataDir)) { New-Item -ItemType Directory -Path $RedisDataDir | Out-Null }
    Write-Host "    Starting local redis-server..."
    Start-Process -FilePath "redis-server" -ArgumentList "--port $RedisPort","--dir $RedisDataDir","--appendonly yes" -WindowStyle Minimized | Out-Null
    Start-Sleep -Milliseconds 800
  }
}

Write-Host "==> Checking DB readiness..."
if (Get-Command pg_isready -ErrorAction SilentlyContinue) {
  & pg_isready -d $DATABASE_URL 2>$null
  if ($LASTEXITCODE -ne 0) {
    1..60 | ForEach-Object {
      & pg_isready -d $DATABASE_URL 2>$null
      if ($LASTEXITCODE -eq 0) { return }
      Start-Sleep -Seconds 1
    }
  }
} else {
  Write-Warning "pg_isready not found; skipping readiness probe."
}

Write-Host "==> Running DB migrations..."
Push-Location $BackendDir
if (Get-Command npx -ErrorAction SilentlyContinue) { npx knex migrate:latest } else { knex migrate:latest }
Pop-Location

Write-Host "==> Starting backend & frontend"
$back = Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory $BackendDir -PassThru
$front = Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory $FrontendDir -PassThru
Write-Host ("    Backend PID: {0}  |  Frontend PID: {1}" -f $back.Id, $front.Id)
