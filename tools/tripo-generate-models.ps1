param(
    [string]$SourceDir = (Join-Path $PSScriptRoot '..\src\assets\character-sources'),
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\src\assets\models-v2'),
    [string[]]$Names = @('peashooter', 'wallnut', 'auditor', 'client', 'kpi', 'traitor', 'boss'),
    [hashtable]$ExistingTaskIds = @{}
)

$ErrorActionPreference = 'Stop'
$apiKey = $env:TRIPO_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'TRIPO_API_KEY is required.'
}

$headers = @{ Authorization = "Bearer $apiKey" }
$apiRoot = 'https://api.tripo3d.ai/v2/openapi'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

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

function Start-ImageModelTask([string]$name) {
    $imagePath = Join-Path $SourceDir "$name-source-v2-alpha.png"
    if (-not (Test-Path -LiteralPath $imagePath)) {
        throw "Missing source image: $imagePath"
    }

    $upload = Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri "$apiRoot/upload/sts" -Headers $headers -Form @{ file = Get-Item -LiteralPath $imagePath } } "Upload $name"
    $payload = @{
        type = 'image_to_model'
        model_version = 'v3.1-20260211'
        file = @{ type = 'png'; file_token = $upload.data.image_token }
        enable_image_autofix = $true
        texture = $true
        texture_quality = 'standard'
        pbr = $false
        smart_low_poly = $true
        face_limit = 15000
        auto_size = $true
    } | ConvertTo-Json -Depth 6
    $task = Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri "$apiRoot/task" -Headers $headers -ContentType 'application/json' -Body $payload } "Submit $name"
    [pscustomobject]@{ name = $name; taskId = $task.data.task_id; status = 'queued'; progress = 0 }
}

$tasks = @($ExistingTaskIds.GetEnumerator() | ForEach-Object {
    [pscustomobject]@{ name = $_.Key; taskId = $_.Value; status = 'queued'; progress = 0 }
})
foreach ($name in $Names) {
    $tasks += Start-ImageModelTask $name
    Write-Host "SUBMITTED $name $($tasks[-1].taskId)"
}

$deadline = (Get-Date).AddMinutes(45)
while (($tasks | Where-Object status -NotIn @('success', 'failed', 'cancelled')).Count -gt 0) {
    if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for Tripo tasks.' }
    Start-Sleep -Seconds 8
    foreach ($task in $tasks | Where-Object status -NotIn @('success', 'failed', 'cancelled')) {
        $state = Invoke-WithRetry { Invoke-RestMethod -Method Get -Uri "$apiRoot/task/$($task.taskId)" -Headers $headers } "Poll $($task.name)"
        $task.status = $state.data.status
        $task.progress = $state.data.progress
        Write-Host "STATUS $($task.name) $($task.status) $($task.progress)%"
        if ($task.status -eq 'success') {
            $target = Join-Path $OutputDir "$($task.name).glb"
            Invoke-WithRetry { Invoke-WebRequest -Uri $state.data.output.model -OutFile $target } "Download $($task.name)" | Out-Null
            Write-Host "DOWNLOADED $($task.name) $target"
        }
    }
}

$failed = @($tasks | Where-Object status -ne 'success')
$manifestPath = Join-Path $OutputDir 'tripo-static-tasks.json'
$tasks | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8
if ($failed.Count -gt 0) {
    throw "Tripo generation failed for: $($failed.name -join ', ')"
}

Get-ChildItem -LiteralPath $OutputDir -Filter '*.glb' | Sort-Object Name | Select-Object Name, Length
