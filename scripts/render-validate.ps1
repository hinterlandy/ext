# Validate render.yaml against Render API (no resources created).
param(
  [string]$OwnerId = $env:RENDER_OWNER_ID,
  [string]$ApiKey = $env:RENDER_API_KEY,
  [string]$BlueprintPath = (Join-Path $PSScriptRoot "..\render.yaml")
)

if (-not $ApiKey) { Write-Error "Set RENDER_API_KEY"; exit 1 }
if (-not $OwnerId) { Write-Error "Set RENDER_OWNER_ID"; exit 1 }
if (-not (Test-Path $BlueprintPath)) { Write-Error "Missing $BlueprintPath"; exit 1 }

$boundary = [Guid]::NewGuid().ToString()
$fileBytes = [System.IO.File]::ReadAllBytes($BlueprintPath)
$fileEnc = [System.Text.Encoding]::GetEncoding("iso-8859-1").GetString($fileBytes)
$bodyLines = @(
  "--$boundary",
  "Content-Disposition: form-data; name=`"ownerId`"", "", $OwnerId,
  "--$boundary",
  "Content-Disposition: form-data; name=`"file`"; filename=`"render.yaml`"",
  "Content-Type: application/x-yaml", "", $fileEnc,
  "--$boundary--", ""
)
$body = ($bodyLines -join "`r`n")
$headers = @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "multipart/form-data; boundary=$boundary" }
$response = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/blueprints/validate" -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 8
if (-not $response.valid) { exit 1 }
