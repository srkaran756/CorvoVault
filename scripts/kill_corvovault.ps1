$pattern1 = 'corvovault'
$pattern2 = 'electron \.'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match $pattern1 -or $_.CommandLine -match $pattern2) }
if ($procs) {
  foreach ($p in $procs) {
    Write-Host "Killing PID $($p.ProcessId): $($p.CommandLine)"
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Write-Host "Failed to kill $($p.ProcessId): $_" }
  }
} else {
  Write-Host 'No matching CorvoVault processes found.'
}
