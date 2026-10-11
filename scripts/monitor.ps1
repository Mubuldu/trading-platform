# monitor.ps1 - Live terminal P&L dashboard for the paper trading bot
#
# Usage:
#   .\scripts\monitor.ps1
#   .\scripts\monitor.ps1 -BaseUrl http://localhost:3000 -ApiKey my-key -RefreshMs 2000
#
# Redraws every RefreshMs ms in-place. Press Ctrl+C to exit.
param(
    [string]$BaseUrl   = "http://127.0.0.1:3000",
    [string]$ApiKey    = "dev-secret-key-not-for-production-use-only",
    [int]   $RefreshMs = 3000,
    [int]   $ChartRows = 10,
    [int]   $MaxPoints = 240   # points kept in memory (~12 min at 3 s)
)

$h = @{ "x-api-key" = $ApiKey }

# Unicode chars as variables so encoding never matters
$C_DASH  = [char]0x2500  # horizontal line
$C_VERT  = [char]0x2502  # vertical line
$C_TEE   = [char]0x2524  # right tee (for baseline axis tick)
$C_CORN  = [char]0x2514  # bottom-left corner
$C_FILL  = [char]0x2591  # light shade (area fill)
$C_DOT   = [char]0x25CF  # filled circle (equity point)
$C_UP    = [char]0x25B2  # up triangle (buy fill)
$C_DOWN  = [char]0x25BC  # down triangle (sell fill)

# ---- State ------------------------------------------------------------------
$equitySeries    = [System.Collections.Generic.List[double]]::new()
$tradeMarkers    = [System.Collections.Generic.List[int]]::new()
$tradeMarkerSide = [System.Collections.Generic.List[string]]::new()
$lastTradeCount  = -1
$startEquity     = $null
$iteration       = 0
$lastError       = $null

# ---- Helpers ----------------------------------------------------------------
function Invoke-Api([string]$path) {
    Invoke-RestMethod -Uri "$BaseUrl$path" -Headers $h -TimeoutSec 4 -ErrorAction Stop
}

function fmtN([double]$n, [int]$d = 2) { return "{0:N$d}" -f $n }
function fmtS([double]$n, [int]$d = 2) {
    if ($n -ge 0) { return "+{0:N$d}" -f $n } else { return "-{0:N$d}" -f [math]::Abs($n) }
}

function CheckIcon([bool]$pass) { if ($pass) { "[+]" } else { "[ ]" } }
function CheckFg  ([bool]$pass) { if ($pass) { "Green" } else { "DarkGray" } }

function TrendArrow([string]$trend) {
    switch ($trend) {
        "BULLISH" { return "^" }
        "BEARISH" { return "v" }
        default   { return ">" }
    }
}

# ---- Chart renderer ---------------------------------------------------------
function Draw-Chart {
    param(
        [double[]]$Series,
        [int[]]   $MarkerIdx,
        [string[]]$MarkerSide,
        [int]     $TotalWidth,
        [int]     $Height,
        [double]  $StartValue
    )

    $labelW = 11
    $innerW = $TotalWidth - $labelW - 1

    if ($Series.Count -eq 0 -or $innerW -lt 10) {
        for ($r = 0; $r -lt ($Height + 1); $r++) { Write-Host "" }
        return
    }

    $offset = [math]::Max(0, $Series.Count - $innerW)
    $pts    = $Series[$offset..($Series.Count - 1)]

    $minV = [double]($pts | Measure-Object -Minimum).Minimum
    $maxV = [double]($pts | Measure-Object -Maximum).Maximum

    if ($StartValue -gt 0) {
        $minV = [math]::Min($minV, $StartValue - [math]::Abs($StartValue) * 0.002)
        $maxV = [math]::Max($maxV, $StartValue + [math]::Abs($StartValue) * 0.002)
    }
    $range = $maxV - $minV
    if ($range -lt 0.001) { $minV -= 0.5; $maxV += 0.5; $range = 1.0 }

    $rowOf = foreach ($v in $pts) {
        [int]([math]::Round( (($v - $minV) / $range) * ($Height - 1) ))
    }

    $startRow = [int]([math]::Round( (($StartValue - $minV) / $range) * ($Height - 1) ))
    $startRow = [math]::Max(0, [math]::Min($Height - 1, $startRow))

    $markerCols = @{}
    for ($mi = 0; $mi -lt $MarkerIdx.Count; $mi++) {
        $localCol = $MarkerIdx[$mi] - $offset
        if ($localCol -ge 0 -and $localCol -lt $pts.Count) {
            $markerCols[$localCol] = $MarkerSide[$mi]
        }
    }

    for ($row = $Height - 1; $row -ge 0; $row--) {

        if ($row -eq ($Height - 1)) {
            $lbl = "  {0,7:F2} " -f $maxV
        } elseif ($row -eq [int]($Height / 2)) {
            $mid = $minV + $range / 2
            $lbl = "  {0,7:F2} " -f $mid
        } elseif ($row -eq 0) {
            $lbl = "  {0,7:F2} " -f $minV
        } else {
            $lbl = " " * $labelW
        }
        Write-Host -NoNewline $lbl -ForegroundColor DarkGray

        if ($row -eq $startRow) {
            Write-Host -NoNewline $C_TEE -ForegroundColor DarkGray
        } else {
            Write-Host -NoNewline $C_VERT -ForegroundColor DarkGray
        }

        for ($col = 0; $col -lt $pts.Count; $col++) {
            $vRow     = $rowOf[$col]
            $v        = $pts[$col]
            $isProfit = ($v -ge $StartValue)
            $hasMark  = $markerCols.ContainsKey($col)
            $markSide = if ($hasMark) { $markerCols[$col] } else { "" }

            if ($row -eq $vRow) {
                if ($hasMark) {
                    if ($markSide -eq "SELL") {
                        Write-Host -NoNewline $C_DOWN -ForegroundColor Red
                    } else {
                        Write-Host -NoNewline $C_UP -ForegroundColor Green
                    }
                } else {
                    $dotColor = if ($isProfit) { "Cyan" } else { "Red" }
                    Write-Host -NoNewline $C_DOT -ForegroundColor $dotColor
                }
            } elseif ($isProfit -and ($row -gt $startRow) -and ($row -lt $vRow)) {
                Write-Host -NoNewline $C_FILL -ForegroundColor DarkGreen
            } elseif ((-not $isProfit) -and ($row -lt $startRow) -and ($row -gt $vRow)) {
                Write-Host -NoNewline $C_FILL -ForegroundColor DarkRed
            } elseif ($row -eq $startRow) {
                Write-Host -NoNewline $C_DASH -ForegroundColor DarkGray
            } else {
                Write-Host -NoNewline " "
            }
        }

        $remaining = $innerW - $pts.Count
        if ($remaining -gt 0) {
            if ($row -eq $startRow) {
                Write-Host -NoNewline (([string]$C_DASH) * $remaining) -ForegroundColor DarkGray
            } else {
                Write-Host -NoNewline (" " * $remaining)
            }
        }

        Write-Host ""
    }

    Write-Host -NoNewline (" " * ($labelW - 1) + " " + $C_CORN + (([string]$C_DASH) * $innerW)) -ForegroundColor DarkGray
    Write-Host ""
}

# ---- Separator --------------------------------------------------------------
function Sep([int]$w) {
    Write-Host (([string]$C_DASH) * $w) -ForegroundColor DarkGray
}

# ---- Main loop --------------------------------------------------------------
Clear-Host
try { [Console]::CursorVisible = $false } catch {}

try {
    while ($true) {
        try { [Console]::SetCursorPosition(0, 0) } catch { Clear-Host }

        $W   = [math]::Max(60, [Console]::WindowWidth - 1)
        $now = Get-Date -Format "HH:mm:ss"

        # -- Fetch -----------------------------------------------------------
        $ov        = $null
        $trd       = $null
        $pos       = $null
        $thgt      = $null
        $connected = $false

        try { $ov   = Invoke-Api "/api/v1/monitor/overview";      $connected = $true; $lastError = $null } catch { $lastError = $_.Exception.Message }
        try { $trd  = Invoke-Api "/api/v1/monitor/trades?limit=8" } catch {}
        try { $pos  = Invoke-Api "/api/v1/monitor/positions"       } catch {}
        try { $thgt = Invoke-Api "/api/v1/monitor/thought"         } catch {}

        # -- Update series ---------------------------------------------------
        if ($ov) {
            $eq = [double]$ov.account.equity
            if ($null -eq $startEquity) { $startEquity = $eq }

            $equitySeries.Add($eq)
            if ($equitySeries.Count -gt $MaxPoints) { $equitySeries.RemoveAt(0) }

            $tc = [int]$ov.account.tradeCount
            if ($lastTradeCount -ge 0 -and $tc -gt $lastTradeCount) {
                $idx  = $equitySeries.Count - 1
                $side = "BUY"
                if ($trd -and $trd.trades -and $trd.trades.Count -gt 0) {
                    $side = if ($trd.trades[0].side) { $trd.trades[0].side.ToUpper() } else { "BUY" }
                }
                $tradeMarkers.Add($idx)
                $tradeMarkerSide.Add($side)
            }
            $lastTradeCount = $tc
        }

        $iteration++

        # -- Header ----------------------------------------------------------
        $statusStr = if ($connected) { " * LIVE " } else { " o NO CONN " }
        $statusFg  = if ($connected) { "Green"    } else { "Red"        }
        $title     = " PAPER TRADING P&L MONITOR"
        $elapsed   = if ($startEquity -ne $null) {
            $s = [int](($iteration - 1) * $RefreshMs / 1000)
            "  session {0:D2}:{1:D2}  " -f [int]($s/60), ($s % 60)
        } else { "  --  " }

        Write-Host -NoNewline $title -ForegroundColor White
        Write-Host -NoNewline " "
        Write-Host -NoNewline $statusStr -ForegroundColor $statusFg
        $pad = $W - $title.Length - $statusStr.Length - $elapsed.Length - $now.Length - 2
        if ($pad -gt 0) { Write-Host -NoNewline (" " * $pad) }
        Write-Host -NoNewline $elapsed -ForegroundColor DarkGray
        Write-Host $now -ForegroundColor DarkGray

        Sep $W

        # -- Stats -----------------------------------------------------------
        if ($ov) {
            $ac = $ov.account; $ri = $ov.risk

            $balStr = "$(fmtN $ac.balance) USDT"
            $eqStr  = "$(fmtN $ac.equity)  USDT"
            $retStr = "$(fmtS $ac.totalReturnPct 2)%"
            $rpStr  = "$(fmtS $ac.totalRealizedPnl) USDT"
            $tcStr  = "$($ac.tradeCount) fills / $($ri.openPositions) open"
            $ddStr  = "$(fmtN $ri.currentDrawdownPct 2)%"

            $retFg = if ($ac.totalReturnPct    -ge 0) { "Green"   } else { "Red"     }
            $rpFg  = if ($ac.totalRealizedPnl  -ge 0) { "Green"   } else { "Red"     }
            $ddFg  = if ($ri.currentDrawdownPct -gt 5) { "Red" } elseif ($ri.currentDrawdownPct -gt 1) { "Yellow" } else { "DarkGray" }

            Write-Host -NoNewline "  BAL "   -ForegroundColor DarkGray
            Write-Host -NoNewline $balStr    -ForegroundColor White
            Write-Host -NoNewline "   EQ "   -ForegroundColor DarkGray
            Write-Host -NoNewline $eqStr     -ForegroundColor Cyan
            Write-Host -NoNewline "   RET "  -ForegroundColor DarkGray
            Write-Host -NoNewline $retStr    -ForegroundColor $retFg
            Write-Host -NoNewline "   PnL "  -ForegroundColor DarkGray
            Write-Host -NoNewline $rpStr     -ForegroundColor $rpFg
            Write-Host -NoNewline "   "
            Write-Host -NoNewline $tcStr     -ForegroundColor DarkGray
            Write-Host -NoNewline "   DD "   -ForegroundColor DarkGray
            Write-Host $ddStr                -ForegroundColor $ddFg
        } else {
            $errTxt = if ($lastError) { $lastError.Substring(0, [math]::Min($lastError.Length, $W - 4)) } else { "..." }
            Write-Host "  Connecting to $BaseUrl   $errTxt" -ForegroundColor DarkGray
        }

        Sep $W

        # -- Chart label -----------------------------------------------------
        $sv          = if ($startEquity) { $startEquity } else { 1000.0 }
        $chartSubtitle = if ($equitySeries.Count -gt 0) {
            "$($equitySeries.Count) ticks  *  $C_DOT equity  $C_DASH start ($( '{0:N2}' -f $sv ) USDT)  *  $C_UP buy  $C_DOWN sell"
        } else {
            "waiting for first tick..."
        }
        Write-Host "  EQUITY CURVE  $chartSubtitle" -ForegroundColor DarkGray
        Write-Host ""

        # -- Draw chart ------------------------------------------------------
        Draw-Chart `
            -Series     $equitySeries.ToArray() `
            -MarkerIdx  $tradeMarkers.ToArray() `
            -MarkerSide $tradeMarkerSide.ToArray() `
            -TotalWidth $W `
            -Height     $ChartRows `
            -StartValue $sv

        Sep $W

        # -- Positions -------------------------------------------------------
        $posArr = if ($pos -and $pos.positions) { @($pos.positions) } else { @() }
        Write-Host "  OPEN POSITIONS ($($posArr.Count))" -ForegroundColor DarkGray

        if ($posArr.Count -eq 0) {
            Write-Host "  no open positions" -ForegroundColor DarkGray
        } else {
            foreach ($p in $posArr) {
                $dir   = if ($p.direction)         { $p.direction.ToString().PadRight(5)           } else { "LONG " }
                $sym   = if ($p.symbol)            { $p.symbol.ToString().PadRight(10)              } else { "--        " }
                $qty   = if ($p.quantity)          { "{0:F4}" -f [double]$p.quantity                } else { "--    " }
                $entry = if ($p.averageEntryPrice) { "{0:N2}" -f [double]$p.averageEntryPrice       } else { "--" }
                $upnl  = if ($p.unrealizedPnl -ne $null) { [double]$p.unrealizedPnl } else { 0.0 }
                $upFg  = if ($upnl -ge 0) { "Green" } else { "Red" }

                Write-Host -NoNewline "  $dir " -ForegroundColor Cyan
                Write-Host -NoNewline "$sym  qty $qty  entry `$$entry  upnl " -ForegroundColor White
                Write-Host "$(fmtS $upnl) USDT" -ForegroundColor $upFg
            }
        }

        Write-Host ""

        # -- Recent trades ---------------------------------------------------
        $trdArr = if ($trd -and $trd.trades) { @($trd.trades) } else { @() }
        Write-Host "  RECENT FILLS ($($trdArr.Count))" -ForegroundColor DarkGray

        if ($trdArr.Count -eq 0) {
            Write-Host "  no fills yet" -ForegroundColor DarkGray
        } else {
            foreach ($t in $trdArr) {
                $side   = if ($t.side)     { $t.side.ToString().ToUpper()      } else { "?" }
                $sym2   = if ($t.symbol)   { $t.symbol.ToString().PadRight(10) } else { "--        " }
                $qty2   = if ($t.quantity  -ne $null) { "{0:F4}" -f [double]$t.quantity } else { "--    " }
                $price2 = if ($t.price     -ne $null) { "{0:N2}"  -f [double]$t.price   } else { "--" }
                $ts2    = if ($t.timestamp -ne $null) {
                    try { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$t.timestamp).ToLocalTime().ToString("HH:mm:ss") } catch { "--" }
                } elseif ($t.executedAt) { $t.executedAt.ToString().Substring(11, 8) } else { "--" }
                $rpnl   = if ($t.realizedPnl -ne $null) { [double]$t.realizedPnl } else { $null }
                $sideFg = if ($side -eq "BUY") { "Green" } else { "Red" }

                Write-Host -NoNewline "  "
                Write-Host -NoNewline ($side.PadRight(5)) -ForegroundColor $sideFg
                Write-Host -NoNewline "$sym2  qty $qty2  @`$$price2" -ForegroundColor White
                if ($rpnl -ne $null) {
                    $rpFg2 = if ($rpnl -ge 0) { "Green" } else { "Red" }
                    Write-Host -NoNewline "  pnl " -ForegroundColor DarkGray
                    Write-Host -NoNewline (fmtS $rpnl) -ForegroundColor $rpFg2
                    Write-Host -NoNewline " USDT" -ForegroundColor DarkGray
                }
                Write-Host "  $ts2" -ForegroundColor DarkGray
            }
        }

        Sep $W

        # -- Strategy Brain --------------------------------------------------
        $thoughts = if ($thgt -and $thgt.thoughts) { @($thgt.thoughts) } else { @() }
        Write-Host "  STRATEGY BRAIN" -ForegroundColor DarkGray

        if ($thoughts.Count -eq 0) {
            Write-Host "  waiting for strategy data..." -ForegroundColor DarkGray
        } else {
            foreach ($th in $thoughts) {
                $mode   = if ($th.mode) { $th.mode } else { "?" }
                $modeFg = switch ($mode) {
                    "IN_POSITION" { "Cyan"     }
                    "SCANNING"    { "Yellow"   }
                    "COOLDOWN"    { "Red"      }
                    "NO_DATA"     { "DarkGray" }
                    default       { "White"    }
                }

                # Mode badge + summary
                Write-Host -NoNewline "  [$mode] " -ForegroundColor $modeFg
                $summary    = if ($th.summary) { $th.summary } else { "--" }
                $maxSummary = $W - $mode.Length - 6
                if ($summary.Length -gt $maxSummary -and $maxSummary -gt 10) {
                    $summary = $summary.Substring(0, $maxSummary - 3) + "..."
                }
                Write-Host $summary -ForegroundColor White

                # Indicator row
                $ind = $th.indicators
                if ($ind) {
                    $trendFg = switch ($ind.emaTrend) {
                        "BULLISH" { "Green"    }
                        "BEARISH" { "Red"      }
                        default   { "DarkGray" }
                    }
                    $adxFg = if ($ind.adxTrending)    { "Green"  } else { "Yellow" }
                    $volFg = if ($ind.volumeConfirmed) { "Green"  } else { "Yellow" }
                    $arrow = TrendArrow $ind.emaTrend

                    Write-Host -NoNewline "    EMA "       -ForegroundColor DarkGray
                    Write-Host -NoNewline "$arrow $($ind.emaTrend)  " -ForegroundColor $trendFg
                    Write-Host -NoNewline "ADX "           -ForegroundColor DarkGray
                    Write-Host -NoNewline "$('{0:F1}' -f [double]$ind.adx)  " -ForegroundColor $adxFg
                    Write-Host -NoNewline "ATR "           -ForegroundColor DarkGray
                    Write-Host -NoNewline "$('{0:F2}' -f [double]$ind.atr)  " -ForegroundColor White
                    Write-Host -NoNewline "Vol "           -ForegroundColor DarkGray
                    Write-Host -NoNewline "$('{0:F0}' -f ([double]$ind.volumeRatio * 100))%  " -ForegroundColor $volFg
                    Write-Host -NoNewline "Donchian "      -ForegroundColor DarkGray
                    Write-Host "$('{0:F0}' -f [double]$ind.donchianLower)-$('{0:F0}' -f [double]$ind.donchianUpper)" -ForegroundColor White
                }

                # Entry checklist (only when scanning/flat)
                $cl = $th.entryChecklist
                if ($cl) {
                    $items = @(
                        @{ lbl = "ADX";      pass = [bool]$cl.adxTrending.pass      },
                        @{ lbl = "EMA";      pass = [bool]$cl.emaAligned.pass       },
                        @{ lbl = "Breakout"; pass = [bool]$cl.donchianBreakout.pass },
                        @{ lbl = "Volume";   pass = [bool]$cl.volumeConfirmed.pass  },
                        @{ lbl = "Cooldown"; pass = [bool]$cl.cooldownClear.pass    }
                    )
                    Write-Host -NoNewline "    Checklist: " -ForegroundColor DarkGray
                    foreach ($item in $items) {
                        $icon = CheckIcon $item.pass
                        $fg   = CheckFg   $item.pass
                        Write-Host -NoNewline "$icon $($item.lbl)  " -ForegroundColor $fg
                    }
                    Write-Host ""
                }

                # Active position bar
                $ap = $th.activePosition
                if ($ap) {
                    $pnlFg = if ([double]$ap.currentPrice -ge [double]$ap.entryPrice) { "Green" } else { "Red" }
                    Write-Host -NoNewline "    Entry "   -ForegroundColor DarkGray
                    Write-Host -NoNewline "`$$('{0:N2}' -f [double]$ap.entryPrice)  " -ForegroundColor White
                    Write-Host -NoNewline "Now "        -ForegroundColor DarkGray
                    Write-Host -NoNewline "`$$('{0:N2}' -f [double]$ap.currentPrice)  " -ForegroundColor $pnlFg
                    Write-Host -NoNewline "Stop "       -ForegroundColor DarkGray
                    Write-Host -NoNewline "`$$('{0:N2}' -f [double]$ap.trailingStop)  " -ForegroundColor Yellow
                    Write-Host -NoNewline "Candles "    -ForegroundColor DarkGray
                    Write-Host "$($ap.candlesHeld)/$($ap.maxHoldingCandles)" -ForegroundColor White
                }

                # Last signal
                if ($th.lastSignalReason) {
                    $sigDir = if ($th.lastSignalDirection) { $th.lastSignalDirection } else { "" }
                    $sigFg  = if ($sigDir -eq "BUY") { "Green" } elseif ($sigDir -eq "SELL" -or $sigDir -eq "EXIT") { "Red" } else { "White" }
                    $sigTs  = if ($th.lastSignalAt) {
                        try { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$th.lastSignalAt).ToLocalTime().ToString("HH:mm:ss") } catch { "" }
                    } else { "" }
                    $reason    = $th.lastSignalReason
                    $maxReason = $W - $sigDir.Length - 28
                    if ($reason.Length -gt $maxReason -and $maxReason -gt 10) { $reason = $reason.Substring(0, $maxReason - 3) + "..." }
                    Write-Host -NoNewline "    Last signal " -ForegroundColor DarkGray
                    Write-Host -NoNewline "$sigDir "         -ForegroundColor $sigFg
                    Write-Host -NoNewline "at $sigTs "       -ForegroundColor DarkGray
                    Write-Host "-- $reason"                  -ForegroundColor DarkGray
                }
            }
        }

        Sep $W
        Write-Host "  Ctrl+C to exit  *  refresh every $($RefreshMs/1000)s  *  $BaseUrl" -ForegroundColor DarkGray

        # Erase stale lines below (handles terminal shrinking)
        for ($i = 0; $i -lt 3; $i++) { Write-Host (" " * $W) }

        Start-Sleep -Milliseconds $RefreshMs
    }
} finally {
    try { [Console]::CursorVisible = $true } catch {}
    Write-Host "`nMonitor stopped." -ForegroundColor DarkGray
}
