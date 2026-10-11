# mock-test.ps1 - End-to-end smoke test for the trading bot API
#
# Usage:
#   .\scripts\mock-test.ps1
#   .\scripts\mock-test.ps1 -BaseUrl http://localhost:3000 -ApiKey my-key
param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [string]$ApiKey  = "dev-secret-key-not-for-production-use-only"
)

$h = @{ "x-api-key" = $ApiKey; "Content-Type" = "application/json" }
$pass = 0; $fail = 0

function Pass([string]$label) {
    Write-Host "  [PASS] $label" -ForegroundColor Green
    $script:pass++
}
function Fail([string]$label, [string]$err) {
    Write-Host "  [FAIL] $label -- $err" -ForegroundColor Red
    $script:fail++
}
function Section([string]$title) {
    Write-Host ""
    Write-Host "--- $title ---" -ForegroundColor Cyan
}
function Info([string]$msg) {
    Write-Host "       $msg" -ForegroundColor DarkGray
}

function Get-Api([string]$path) {
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Headers $h -TimeoutSec 10
}
function Post-Api([string]$path, $body) {
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Headers $h -Body ($body | ConvertTo-Json) -TimeoutSec 30
}

Write-Host ""
Write-Host "Trading Bot - Mock Test Suite" -ForegroundColor Yellow
Write-Host "Target: $BaseUrl" -ForegroundColor DarkGray
Write-Host "------------------------------------------------------" -ForegroundColor DarkGray

# ---- 1. Health ---------------------------------------------------------------
Section "1. Health"
try {
    $live = Get-Api "/api/v1/health/live"
    if ($live.status -eq "alive") { Pass "GET /health/live -> status=alive" }
    else { Fail "GET /health/live" "status=$($live.status)" }
} catch { Fail "GET /health/live" "$_" }

try {
    $health = Get-Api "/api/v1/health"
    Pass "GET /health -> $($health.status)"
} catch { Fail "GET /health" "$_" }

# ---- 2. Monitor overview -----------------------------------------------------
Section "2. Monitor - Overview"
$overview = $null
try {
    $overview = Get-Api "/api/v1/monitor/overview"
    Pass "GET /monitor/overview"
    Info "balance  = $($overview.account.balance) USDT"
    Info "equity   = $($overview.account.equity) USDT"
    Info "drawdown = $($overview.risk.currentDrawdownPct)%"
    Info "strats   = $($overview.strategy.totalRegistered) registered, $($overview.strategy.totalEnabled) enabled"
} catch { Fail "GET /monitor/overview" "$_" }

# ---- 3. Positions, Orders, Trades --------------------------------------------
Section "3. Monitor - Positions / Orders / Trades"
try {
    $pos = Get-Api "/api/v1/monitor/positions"
    Pass "GET /monitor/positions -> $($pos.count) open"
} catch { Fail "GET /monitor/positions" "$_" }

try {
    $ord = Get-Api "/api/v1/monitor/orders"
    Pass "GET /monitor/orders -> $($ord.count) pending"
} catch { Fail "GET /monitor/orders" "$_" }

try {
    $trades = Get-Api "/api/v1/monitor/trades?limit=10"
    Pass "GET /monitor/trades -> $($trades.count) recent"
} catch { Fail "GET /monitor/trades" "$_" }

# ---- 4. Performance + Strategy -----------------------------------------------
Section "4. Monitor - Performance / Strategy"
try {
    $perf = Get-Api "/api/v1/monitor/performance"
    Pass "GET /monitor/performance -> daily=$($perf.daily -ne $null) drawdown=$($perf.drawdown -ne $null)"
} catch { Fail "GET /monitor/performance" "$_" }

try {
    $strat = Get-Api "/api/v1/monitor/strategy"
    Pass "GET /monitor/strategy -> $($strat.summary.totalRegistered) registered"
    foreach ($s in $strat.strategies) {
        Info "$($s.id) -- state=$($s.state) enabled=$($s.enabled)"
    }
} catch { Fail "GET /monitor/strategy" "$_" }

# ---- 5. MARKET BUY (fills immediately) --------------------------------------
Section "5. Test Order - MARKET BUY 0.001 BTC/USDT"
$balanceBefore = if ($overview) { $overview.account.balance } else { $null }
try {
    $mkt = Post-Api "/api/v1/monitor/test/order" @{
        symbol   = "BTC/USDT"
        side     = "BUY"
        type     = "MARKET"
        quantity = 0.001
    }
    if ($mkt.ok) {
        Pass "POST /monitor/test/order (MARKET) -> status=$($mkt.status)"
        Info "orderId = $($mkt.orderId)"
        Info "note    = $($mkt.note)"
    } else {
        Fail "POST /monitor/test/order (MARKET)" "$($mkt.error)"
    }
} catch { Fail "POST /monitor/test/order (MARKET)" "$_" }

Start-Sleep -Seconds 3

try {
    # Use in-memory account state (not Redis) to confirm the fill executed.
    # Trade history endpoint reads from Redis which can stall on Docker Desktop Windows.
    $snap = Get-Api "/api/v1/monitor/overview"
    $tradesBefore = if ($overview) { $overview.account.tradeCount } else { 0 }
    if ($snap.account.tradeCount -gt $tradesBefore) {
        Pass "MARKET fill confirmed: tradeCount $tradesBefore -> $($snap.account.tradeCount) | balance=$($snap.account.balance) USDT"
    } else {
        Fail "MARKET fill check" "tradeCount unchanged ($($snap.account.tradeCount)) - no price tick or fill hung"
    }
} catch { Fail "MARKET fill check" "$_" }

# ---- 6. LIMIT BUY (sits in order book) --------------------------------------
Section "6. Test Order - LIMIT BUY 0.001 BTC/USDT @ 10000"
try {
    $lmt = Post-Api "/api/v1/monitor/test/order" @{
        symbol   = "BTC/USDT"
        side     = "BUY"
        type     = "LIMIT"
        quantity = 0.001
        price    = 10000
    }
    if ($lmt.ok) {
        Pass "POST /monitor/test/order (LIMIT) -> status=$($lmt.status)"
        Info "orderId = $($lmt.orderId)"
    } else {
        Fail "POST /monitor/test/order (LIMIT)" "$($lmt.error)"
    }
} catch { Fail "POST /monitor/test/order (LIMIT)" "$_" }

Start-Sleep -Milliseconds 400

try {
    $ordAfter = Get-Api "/api/v1/monitor/orders"
    if ($ordAfter.count -gt 0) {
        Pass "Pending orders has $($ordAfter.count) entry/entries"
        $o = $ordAfter.orders[0]
        Info "order: $($o.side) $($o.requestedQuantity) $($o.symbol) limit=$($o.limitPrice) state=$($o.state)"
    } else {
        Fail "Pending orders after limit submit" "still 0 orders"
    }
} catch { Fail "Pending orders check" "$_" }

# ---- 7. Final snapshot -------------------------------------------------------
Section "7. Final Snapshot"
try {
    $final = Get-Api "/api/v1/monitor/overview"
    Pass "GET /monitor/overview (final)"
    Info "balance   = $($final.account.balance) USDT  (was $balanceBefore)"
    Info "equity    = $($final.account.equity) USDT"
    Info "trades    = $($final.account.tradeCount)"
    Info "positions = $($final.risk.openPositions)"
    Info "orders    = $($final.risk.pendingOrders)"
} catch { Fail "GET /monitor/overview (final)" "$_" }

# ---- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host "------------------------------------------------------" -ForegroundColor DarkGray
$total = $pass + $fail
if ($fail -eq 0) {
    Write-Host "Result: $pass/$total passed - ALL GREEN" -ForegroundColor Green
} else {
    Write-Host "Result: $pass/$total passed, $fail failed" -ForegroundColor Yellow
    Write-Host "Check bot logs for details on failures." -ForegroundColor Red
}
Write-Host ""
