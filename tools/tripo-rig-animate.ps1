param(
    [Parameter(Mandatory)] [hashtable]$ModelTaskIds,
    [Parameter(Mandatory)] [hashtable]$Animations,
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\src\assets\models-v2')
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

function Wait-Tasks([array]$Tasks, [string]$Phase) {
    while (($Tasks | Where-Object status -NotIn @('success', 'failed', 'cancelled')).Count -gt 0) {
        Start-Sleep -Seconds 7
        foreach ($task in $Tasks | Where-Object status -NotIn @('success', 'failed', 'cancelled')) {
            $state = Invoke-WithRetry { Invoke-RestMethod -Method Get -Uri "$apiRoot/task/$($task.taskId)" -Headers $headers } "Poll $Phase $($task.name)"
            $task.status = $state.data.status
            $task.output = $state.data.output
            Write-Host "STATUS $Phase $($task.name) $($task.status) $($state.data.progress)%"
        }
    }
    $failed = @($Tasks | Where-Object status -ne 'success')
    if ($failed.Count -gt 0) { throw "$Phase failed for: $($failed.name -join ', ')" }
}

$rigTasks = @()
foreach ($entry in $ModelTaskIds.GetEnumerator()) {
    $body = @{
        type = 'animate_rig'
        original_model_task_id = $entry.Value
        out_format = 'glb'
        model_version = 'v2.5-20260210'
        rig_type = 'biped'
        spec = 'tripo'
    } | ConvertTo-Json
    $response = Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri "$apiRoot/task" -Headers $headers -ContentType 'application/json' -Body $body } "Submit rig $($entry.Key)"
    $rigTasks += [pscustomobject]@{ name = $entry.Key; modelTaskId = $entry.Value; taskId = $response.data.task_id; status = 'queued'; output = $null }
    Write-Host "SUBMITTED rig $($entry.Key) $($response.data.task_id)"
}
Wait-Tasks $rigTasks 'rig'

$animationTasks = @()
foreach ($rig in $rigTasks) {
    $preset = $Animations[$rig.name]
    if ([string]::IsNullOrWhiteSpace($preset)) { throw "Missing animation preset for $($rig.name)" }
    $body = @{
        type = 'animate_retarget'
        original_model_task_id = $rig.taskId
        out_format = 'glb'
        animation = $preset
        bake_animation = $true
        export_with_geometry = $true
        animate_in_place = $true
    } | ConvertTo-Json
    $response = Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri "$apiRoot/task" -Headers $headers -ContentType 'application/json' -Body $body } "Submit animation $($rig.name)"
    $animationTasks += [pscustomobject]@{ name = $rig.name; preset = $preset; rigTaskId = $rig.taskId; taskId = $response.data.task_id; status = 'queued'; output = $null }
    Write-Host "SUBMITTED animation $($rig.name) $preset $($response.data.task_id)"
}
Wait-Tasks $animationTasks 'animation'

foreach ($task in $animationTasks) {
    $target = Join-Path $OutputDir "$($task.name)-animated.glb"
    Invoke-WithRetry { Invoke-WebRequest -Uri $task.output.model -OutFile $target } "Download animation $($task.name)" | Out-Null
    Write-Host "DOWNLOADED $($task.name) $target"
}

$manifest = [pscustomobject]@{ rigs = $rigTasks; animations = $animationTasks }
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDir 'tripo-animation-tasks.json') -Encoding utf8
Get-ChildItem -LiteralPath $OutputDir -Filter '*-animated.glb' | Sort-Object Name | Select-Object Name, Length
