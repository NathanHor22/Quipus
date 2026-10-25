param([switch]$Clean, [string]$Version, [switch]$BenchRollback)

& (Join-Path $PSScriptRoot "build-profile.ps1") -Profile waveshare -Clean:$Clean -Version $Version -BenchRollback:$BenchRollback
exit $LASTEXITCODE
