# 把带语法着色的代码渲染成 PNG。零 npm 依赖，走 Windows 自带的 System.Drawing。
#
# 两种用法：
#   单张：-InputFile a.ts -OutputFile a.png [-Caption 标题] [-MaxWidth 960]
#   批量：-Manifest jobs.json
#
# 批量模式下 job 里带 segments——按行拆好的彩色片段：
#   { input, output, caption, maxWidth,
#     segments: [ [ { t: 'const', c: 'CF222E' }, ... ], ... ] }
# 着色是调用方算的（lib/highlight.js），这里只管测量和画。
# segments 缺失时退回读 input 文件、整段单色，方便单张调试。
param(
  [string]$InputFile,
  [string]$OutputFile,
  [string]$Manifest,
  [int]$MaxWidth = 960,
  [int]$FontSize = 18,
  [string]$Caption = ''
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$DEFAULT_COLOR = '24292F'
$GUTTER_COLOR = 'A5ACB4'
$CAPTION_COLOR = '555C64'

function New-Font2([string]$family, [int]$size, [System.Drawing.FontStyle]$style) {
  New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function Get-Color([string]$hex) {
  [System.Drawing.ColorTranslator]::FromHtml('#' + $hex)
}

function Render-Code($job) {
  $dest = [string]$job.output
  $cap = if ($null -ne $job.caption) { [string]$job.caption } else { '' }
  $maxW = if ($job.maxWidth) { [int]$job.maxWidth } else { $MaxWidth }

  # 统一成「按行的彩色片段」：批量模式用 segments，单张模式读文件
  $lines = @()
  if ($null -ne $job.segments) {
    $lines = @($job.segments)
  } else {
    $text = [System.IO.File]::ReadAllText([string]$job.input, [System.Text.Encoding]::UTF8)
    $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
    $raw = $text -split "`n"
    if ($raw.Length -gt 0 -and $raw[-1] -eq '') { $raw = $raw[0..($raw.Length - 2)] }
    $lines = @($raw | ForEach-Object { , @(@{ t = $_; c = $DEFAULT_COLOR }) })
  }
  if ($lines.Count -eq 0) { $lines = @(, @(@{ t = ''; c = $DEFAULT_COLOR })) }

  $mono = New-Font2 'Consolas' $FontSize ([System.Drawing.FontStyle]::Regular)
  $capFont = New-Font2 'Microsoft YaHei' ($FontSize - 4) ([System.Drawing.FontStyle]::Bold)

  # GenericTypographic 去掉默认的行边距，MeasureString 给出的才是真实字宽；
  # 再加 MeasureTrailingSpaces，否则段尾空格不计宽，按列定位会逐渐偏移。
  $fmt = [System.Drawing.StringFormat]::GenericTypographic.Clone()
  $fmt.FormatFlags = $fmt.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces

  $probeBmp = New-Object System.Drawing.Bitmap(1, 1)
  $probe = [System.Drawing.Graphics]::FromImage($probeBmp)
  $probe.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $origin = New-Object System.Drawing.PointF(0, 0)
  $charW = [double]$probe.MeasureString('M', $mono, $origin, $fmt).Width
  $lineH = [int][Math]::Ceiling($mono.GetHeight($probe) * 1.6)
  $capH = 0
  if ($cap -ne '') { $capH = [int][Math]::Ceiling($probe.MeasureString($cap, $capFont, $origin, $fmt).Height) + 14 }

  $padX = 32
  $padY = 28
  $digits = [Math]::Max(2, $lines.Count.ToString().Length)
  $gutterW = [int][Math]::Ceiling($charW * ($digits + 1))
  # 折行按「列」算：ASCII 一列，CJK 两列。等宽字体下按列定位不会累积误差。
  $maxCols = [int][Math]::Floor(($maxW - $padX * 2 - $gutterW) / $charW)
  if ($maxCols -lt 20) { $maxCols = 20 }

  # 逐字符折行，同时把同色的连续字符合并成一个绘制片段
  $rows = New-Object System.Collections.ArrayList
  $lineNo = 0
  foreach ($segs in $lines) {
    $lineNo += 1
    $cur = @{ No = $lineNo; Segs = (New-Object System.Collections.ArrayList) }
    $col = 0
    foreach ($seg in @($segs)) {
      if ($null -eq $seg) { continue }
      $color = if ($seg.c) { [string]$seg.c } else { $DEFAULT_COLOR }
      foreach ($ch in ([string]$seg.t).ToCharArray()) {
        $cw = if ([int]$ch -gt 127) { 2 } else { 1 }
        if (($col + $cw) -gt $maxCols -and $col -gt 0) {
          [void]$rows.Add($cur)
          $cur = @{ No = -1; Segs = (New-Object System.Collections.ArrayList) }
          $col = 0
        }
        $last = if ($cur.Segs.Count -gt 0) { $cur.Segs[$cur.Segs.Count - 1] } else { $null }
        if ($last -and $last.c -eq $color) {
          $last.t += $ch
        } else {
          [void]$cur.Segs.Add(@{ t = [string]$ch; c = $color; start = $col })
        }
        $col += $cw
      }
    }
    [void]$rows.Add($cur)
  }

  $maxColsUsed = 0
  foreach ($row in $rows) {
    if ($row.Segs.Count -eq 0) { continue }
    $last = $row.Segs[$row.Segs.Count - 1]
    $end = $last.start
    foreach ($ch in $last.t.ToCharArray()) { $end += if ([int]$ch -gt 127) { 2 } else { 1 } }
    if ($end -gt $maxColsUsed) { $maxColsUsed = $end }
  }

  $width = [int][Math]::Ceiling($maxColsUsed * $charW) + $gutterW + $padX * 2 + 2
  if ($width -gt $maxW) { $width = $maxW }
  if ($width -lt 480) { $width = 480 }
  $height = [int]($rows.Count * $lineH) + $padY * 2 + $capH + 2

  $probe.Dispose()
  $probeBmp.Dispose()

  $bmp = New-Object System.Drawing.Bitmap($width, $height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $g.Clear([System.Drawing.Color]::FromArgb(246, 248, 250))
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(224, 229, 234), 1)
  $g.DrawRectangle($pen, 0, 0, $width - 1, $height - 1)

  $y = $padY
  if ($cap -ne '') {
    $capBrush = New-Object System.Drawing.SolidBrush((Get-Color $CAPTION_COLOR))
    $g.DrawString($cap, $capFont, $capBrush, [single]$padX, [single]$y, $fmt)
    $capBrush.Dispose()
    $y += $capH
  }

  $gutterBrush = New-Object System.Drawing.SolidBrush((Get-Color $GUTTER_COLOR))
  $brushes = @{}

  $idx = 0
  foreach ($row in $rows) {
    $rowY = $y + $idx * $lineH
    if ($row.No -gt 0) {
      $g.DrawString($row.No.ToString().PadLeft($digits), $mono, $gutterBrush, [single]$padX, [single]$rowY, $fmt)
    } elseif ($row.No -eq -1) {
      $g.DrawString([string][char]0x21B3, $mono, $gutterBrush, [single]($padX + $charW * ($digits - 1)), [single]$rowY, $fmt)
    }
    foreach ($seg in $row.Segs) {
      if ($seg.t.Length -eq 0) { continue }
      if (-not $brushes.ContainsKey($seg.c)) {
        $brushes[$seg.c] = New-Object System.Drawing.SolidBrush((Get-Color $seg.c))
      }
      $x = $padX + $gutterW + $seg.start * $charW
      $g.DrawString($seg.t, $mono, $brushes[$seg.c], [single]$x, [single]$rowY, $fmt)
    }
    $idx += 1
  }

  foreach ($b in $brushes.Values) { $b.Dispose() }
  $gutterBrush.Dispose()
  $pen.Dispose()
  $g.Dispose()

  $dir = [System.IO.Path]::GetDirectoryName($dest)
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $mono.Dispose()
  $capFont.Dispose()

  return @{ width = $width; height = $height }
}

if ($Manifest) {
  $jobs = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $n = 0
  foreach ($job in $jobs) {
    $r = Render-Code $job
    $n += 1
    Write-Output ("{0}: {1}x{2} -> {3}" -f $n, $r.width, $r.height, $job.output)
  }
  Write-Output "DONE $n"
} else {
  if (-not $InputFile -or -not $OutputFile) { throw '需要 -InputFile 与 -OutputFile，或改用 -Manifest' }
  $r = Render-Code (@{ input = $InputFile; output = $OutputFile; caption = $Caption; maxWidth = $MaxWidth })
  Write-Output ("OK: {0} {1}x{2}" -f $OutputFile, $r.width, $r.height)
}
