$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'public\assets\textures'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'parkworks-ambientcg-import'
$assetIds = @('Grass005', 'Concrete034', 'PavingStones138', 'Bark014', 'Planks037A')
$manifestPath = Join-Path $assetRoot 'manifest.sha256'

New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

foreach ($assetId in $assetIds) {
  $zipPath = Join-Path $temporaryRoot "$assetId.zip"
  $extractPath = Join-Path $temporaryRoot $assetId
  $targetPath = Join-Path $assetRoot $assetId

  if (Test-Path -LiteralPath $extractPath) {
    $resolvedExtract = (Resolve-Path -LiteralPath $extractPath).Path
    $resolvedTemp = (Resolve-Path -LiteralPath $temporaryRoot).Path
    if (-not $resolvedExtract.StartsWith($resolvedTemp + [System.IO.Path]::DirectorySeparatorChar)) {
      throw "Refusing to clear unexpected extraction path: $resolvedExtract"
    }
    Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
  }

  New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
  New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
  Invoke-WebRequest -Uri "https://ambientcg.com/get?file=${assetId}_1K-JPG.zip" -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

  $maps = @{
    color = '*_Color.jpg'
    normal = '*_NormalGL.jpg'
    roughness = '*_Roughness.jpg'
    ao = '*_AmbientOcclusion.jpg'
  }

  foreach ($mapName in $maps.Keys) {
    $source = Get-ChildItem -LiteralPath $extractPath -Recurse -File -Filter $maps[$mapName] | Select-Object -First 1
    if (-not $source) {
      Write-Warning "$assetId has no $mapName source map"
      continue
    }

    $edge = if ($mapName -eq 'color') { 1024 } else { 512 }
    $quality = if ($mapName -eq 'normal') { 85 } elseif ($mapName -eq 'color') { 82 } else { 78 }
    $target = Join-Path $targetPath "${assetId}_${mapName}.webp"
    & magick $source.FullName -resize "${edge}x${edge}>" -quality $quality -define webp:method=6 $target
    if ($LASTEXITCODE -ne 0) { throw "Image conversion failed for $assetId $mapName" }
  }

  Remove-Item -LiteralPath $zipPath -Force
}

$resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
$systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if (-not $resolvedTemporaryRoot.StartsWith($systemTemp + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to clear unexpected temporary directory: $resolvedTemporaryRoot"
}
Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force

$manifestLines = Get-ChildItem -LiteralPath $assetRoot -Recurse -File -Filter '*.webp' |
  Sort-Object FullName |
  ForEach-Object {
    $relativePath = [System.IO.Path]::GetRelativePath($assetRoot, $_.FullName).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    "$hash  $relativePath"
  }
Set-Content -LiteralPath $manifestPath -Value $manifestLines -Encoding utf8

Get-ChildItem -LiteralPath $assetRoot -Recurse -File | Select-Object FullName, Length
