$ErrorActionPreference = "Stop"

$buildDir = Join-Path $PSScriptRoot "..\build"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$icoPath = Join-Path $buildDir "icon.ico"
$pngPath = Join-Path $buildDir "icon.png"
$sourcePath = Join-Path $PSScriptRoot "..\..\..\..\assets\drsai-transparent.png"

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Source logo not found: $sourcePath"
}

Add-Type -AssemblyName System.Drawing

$size = 256
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

$scale = [Math]::Min($size / $sourceImage.Width, $size / $sourceImage.Height)
$drawWidth = [Math]::Round($sourceImage.Width * $scale)
$drawHeight = [Math]::Round($sourceImage.Height * $scale)
$drawX = [Math]::Round(($size - $drawWidth) / 2)
$drawY = [Math]::Round(($size - $drawHeight) / 2)
$graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new($drawX, $drawY, $drawWidth, $drawHeight))

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create))
try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngBytes.Length)
    $writer.Write([UInt32]22)
    $writer.Write($pngBytes)
} finally {
    $writer.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $sourceImage.Dispose()
}

Get-Item $icoPath, $pngPath | Select-Object FullName, Length
