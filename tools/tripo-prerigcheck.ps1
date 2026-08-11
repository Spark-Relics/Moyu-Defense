param(
    [Parameter(Mandatory)] [hashtable]$ModelTaskIds,
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\src\assets\models-v2\tripo-prerig-results.json')
)

$ErrorActionPreference = 'Stop'
$apiKey = $env:TRIPO_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'TRIPO_API_KEY is required.' }
$headers = @{ Authorization = "Bearer $apiKey" }
$apiRoot = 'https://api.tripo3d.ai/v2/openapi'

function Invoke-WithRetry([scriptblock]$Action, [string]$Label) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try { return & $Action } catch {
            $lastError = $_
            Write-Warning "$Label failed (attempt $attempt/5): $($_.Exception.Message)"
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
    throw $lastError
}

$checks = @()
foreach ($entry in $ModelTaskIds.GetEnumerator()) {
    $body = @{ type = 'animate_prerigcheck'; original_model_task_id = $entry.Value } | ConvertTo-Json
    $response = Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri "$apiRoot/task" -Headers $headers -ContentType 'application/json' -Body $body } "Submit pre-rig $($entry.Key)"
    $checks += [pscustomobject]@{ name = $entry.Key; modelTaskId = $entry.Value; checkTaskId = $response.data.task_id; status = 'queued'; output = $null }
    Write-Host "SUBMITTED $($entry.Key) $($response.data.task_id)"
}

while (($checks | Where-Object status -NotIn @('success', 'failed', 'cancelled')).Count -gt 0) {
    Start-Sleep -Seconds 5
    foreach ($check in $checks | Where-Object status -NotIn @('success', 'failed', 'cancelled')) {
        $state = Invoke-WithRetry { Invoke-RestMethod -Method Get -Uri "$apiRoot/task/$($check.checkTaskId)" -Headers $headers } "Poll pre-rig $($check.name)"
        $check.status = $state.data.status
        if ($state.data.status -eq 'success') { $check.output = $state.data.output }
        Write-Host "STATUS $($check.name) $($check.status) $($state.data.progress)%"
    }
}

$checks | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$checks | Select-Object name, status, @{n='riggable';e={$_.output.riggable}}, @{n='rigType';e={$_.output.rig_type}}, checkTaskId
