#!/usr/bin/env pwsh

$scriptPath = Join-Path $PSScriptRoot "ra.mjs"
& node $scriptPath @args
exit $LASTEXITCODE
