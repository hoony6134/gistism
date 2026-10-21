# 포토부스 로컬 서버 (Windows, 별도 설치 없이 PowerShell만 사용)
# server.py 와 같은 API를 제공한다.
#   GET  /api/frames        프레임 목록 {"images": [{"path", "type"}], "folders": [...]}
#                           images: frames\normal, frames\character 안의 jpg/png
#                           folders: frame.json이 있는 frames\<폴더> (예전 방식)
#   POST /api/save?name=..  요청 본문(이미지)을 output\YYYY-MM-DD\<name> 으로 저장
#   POST /api/log           요청 본문(JSON 한 줄)을 logs\YYYY-MM-DD.jsonl 에 추가
#   GET  /api/printers      프린터 목록 {"printers": [...], "default": "..."}
#   POST /api/print?printer=..&copies=..  요청 본문(JPG)을 그 프린터로 바로 인쇄 (인쇄 창 없음)
#   GET  그 외              정적 파일

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8787
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$Types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.webp' = 'image/webp'; '.gif' = 'image/gif'
  '.ttf' = 'font/ttf'; '.otf' = 'font/otf'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
  '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
}

function Send-Bytes($res, [byte[]]$bytes, $type, $status = 200) {
  $res.StatusCode = $status
  $res.ContentType = $type
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-Json($res, $text, $status = 200) {
  Send-Bytes $res $Utf8.GetBytes($text) 'application/json; charset=utf-8' $status
}

function Read-Body($req) {
  $ms = New-Object System.IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  return $ms.ToArray()
}

function Today { (Get-Date).ToString('yyyy-MM-dd') }

Add-Type -AssemblyName System.Drawing

function Get-PrinterNames {
  @(Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name)
}
function Get-DefaultPrinter {
  (Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name
}

# 사진 한 장(JPG)을 프린터로 보낸다. 용지는 엽서(100x148mm)를 찾아 고르고, 여백 없이 용지 전체에 그린다.
function Send-ToPrinter([byte[]]$bytes, [string]$printer, [int]$copies) {
  $ms = New-Object System.IO.MemoryStream(, $bytes)
  $img = [System.Drawing.Image]::FromStream($ms)
  try {
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.DocumentName = 'photobooth'
    $doc.PrinterSettings.PrinterName = $printer
    if (-not $doc.PrinterSettings.IsValid) { throw "프린터를 찾을 수 없어요: $printer" }
    $doc.PrinterSettings.Copies = [int16]$copies
    $postcard = $doc.PrinterSettings.PaperSizes | Where-Object {
      [math]::Abs($_.Width - 394) -lt 10 -and [math]::Abs($_.Height - 583) -lt 10
    } | Select-Object -First 1
    if ($postcard) { $doc.DefaultPageSettings.PaperSize = $postcard }
    $doc.DefaultPageSettings.Landscape = $false
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.OriginAtMargins = $false
    $doc.add_PrintPage({
      param($sender, $e)
      $b = $e.PageBounds
      # 인쇄 가능 영역 바깥까지 채우도록 하드웨어 여백만큼 당겨서 그린다 (테두리 없음 설정과 함께 쓰기)
      $x = - $e.PageSettings.HardMarginX
      $y = - $e.PageSettings.HardMarginY
      $e.Graphics.DrawImage($img, [single]$x, [single]$y, [single]$b.Width, [single]$b.Height)
      $e.HasMorePages = $false
    }.GetNewClosure())
    $doc.Print()
  } finally {
    $img.Dispose()
    $ms.Dispose()
  }
}

function Json-Str($text) { '"' + $text.Replace('\', '\\').Replace('"', '\"') + '"' }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "포토부스 서버 실행 중: http://localhost:$Port/booth/  (이 창을 닫으면 서버가 꺼집니다)"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

    if ($req.HttpMethod -eq 'GET' -and $path -eq '/api/frames') {
      $framesDir = Join-Path $Root 'frames'
      $images = @()
      foreach ($kind in @('normal', 'character')) {
        $dir = Join-Path $framesDir $kind
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $dir -File | Where-Object {
          @('.jpg', '.jpeg', '.png', '.webp') -contains $_.Extension.ToLower() -and -not $_.Name.StartsWith('.')
        } | Sort-Object Name | ForEach-Object {
          $images += '{"path":' + (Json-Str ($kind + '/' + $_.Name)) + ',"type":"' + $kind + '"}'
        }
      }
      $folders = @(Get-ChildItem -LiteralPath $framesDir -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'frame.json') } |
        Sort-Object Name | ForEach-Object { Json-Str $_.Name })
      Send-Json $res ('{"images":[' + ($images -join ',') + '],"folders":[' + ($folders -join ',') + ']}')
    }
    elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/api/save') {
      $name = $req.QueryString['name']
      if (-not $name -or $name -notmatch '^[A-Za-z0-9._-]{1,100}$') {
        Send-Json $res '{"error":"bad name"}' 400
      } else {
        $dir = Join-Path (Join-Path $Root 'output') (Today)
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $dir $name), (Read-Body $req))
        Send-Json $res '{"ok":true}'
      }
    }
    elseif ($req.HttpMethod -eq 'GET' -and $path -eq '/api/printers') {
      $list = @(Get-PrinterNames | ForEach-Object { Json-Str $_ })
      $def = Get-DefaultPrinter
      $defJson = if ($def) { Json-Str $def } else { '""' }
      Send-Json $res ('{"printers":[' + ($list -join ',') + '],"default":' + $defJson + '}')
    }
    elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/api/print') {
      $printer = $req.QueryString['printer']
      $copies = 1
      [int]::TryParse([string]$req.QueryString['copies'], [ref]$copies) | Out-Null
      $copies = [math]::Max(1, [math]::Min(10, $copies))
      if (-not $printer -or (Get-PrinterNames) -notcontains $printer) {
        Send-Json $res '{"error":"printer not found"}' 400
      } else {
        try {
          Send-ToPrinter (Read-Body $req) $printer $copies
          Send-Json $res '{"ok":true}'
        } catch {
          Send-Json $res ('{"error":' + (Json-Str $_.Exception.Message) + '}') 500
        }
      }
    }
    elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/api/log') {
      $line = $Utf8.GetString((Read-Body $req)) -replace "[\r\n]+", ' '
      $dir = Join-Path $Root 'logs'
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      [System.IO.File]::AppendAllText((Join-Path $dir ((Today) + '.jsonl')), $line.Trim() + "`n", $Utf8)
      Send-Json $res '{"ok":true}'
    }
    elseif ($req.HttpMethod -eq 'GET') {
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))
      if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        if (Test-Path -LiteralPath $full -PathType Container) {
          $res.Redirect($req.Url.AbsolutePath + '/')
        } else {
          Send-Bytes $res $Utf8.GetBytes('not found') 'text/plain; charset=utf-8' 404
        }
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $type = $Types[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        Send-Bytes $res ([System.IO.File]::ReadAllBytes($full)) $type
      }
    }
    else {
      Send-Json $res '{"error":"not found"}' 404
    }
  } catch {
    Write-Host "오류: $($_.Exception.Message)"
    try { Send-Json $res '{"error":"server"}' 500 } catch {}
  } finally {
    try { $res.Close() } catch {}
  }
}
