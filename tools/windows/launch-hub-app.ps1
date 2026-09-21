# FEAGLE Hub 轻量原生桌面窗口启动器 (基于系统 Edge WebView2 / App Mode)
$ErrorActionPreference = "Stop"

$HubDir = Join-Path $PSScriptRoot "..\..\apps\hub"
$PublicUrl = "http://127.0.0.1:6200"

Write-Host "正在启动 FEAGLE Hub 后台微服务..." -ForegroundColor Cyan
Start-Process -FilePath "node.exe" -ArgumentList "src/index.js" -WorkingDirectory $HubDir -WindowStyle Hidden

# 等待端口就绪
$Attempts = 0
while ($Attempts -lt 20) {
    try {
        $Tcp = New-Object System.Net.Sockets.TcpClient
        $Tcp.Connect("127.0.0.1", 6200)
        $Tcp.Close()
        break
    } catch {
        Start-Sleep -Milliseconds 200
        $Attempts++
    }
}

Write-Host "正在拉起独立轻量桌面应用窗口 (无边框/无URL栏)..." -ForegroundColor Green

# 优先使用 Windows Edge 应用模式启动独立窗口 (零打包体积，内存极低)
$EdgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $EdgePath)) {
    $EdgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}

if (Test-Path $EdgePath) {
    Start-Process -FilePath $EdgePath -ArgumentList "--app=$PublicUrl", "--window-size=1120,780", "--user-data-dir=$env:TEMP\feagle_hub_webview"
} else {
    Start-Process $PublicUrl
}
