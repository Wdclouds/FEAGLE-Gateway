@echo off
chcp 65001 >nul
echo ==========================================
echo       FEAGLEwxbot 文档库双向同步
echo ==========================================
cd /d "%~dp0"

echo [1/3] 正在拉取云端 ECS 最新文档...
git pull --rebase origin master
if %errorlevel% neq 0 (
    echo [错误] 拉取失败，请检查云端连接或网络！
    pause
    exit /b 1
)

echo [2/3] 检查本地是否有待同步的修改...
git add -A
git diff --cached --quiet
if %errorlevel% neq 0 (
    echo 发现本地变更，正在提交并推送到云端 ECS...
    git commit -m "docs: 桌面端改动同步 [@human]"
    git push origin master
    if %errorlevel% equ 0 (
        echo [3/3] 成功推送到云端真相源！
    ) else (
        echo [错误] 推送失败，请检查 SSH 权限！
        pause
        exit /b 1
    )
) else (
    echo [3/3] 本地无新改动，已与云端保持最新！
)

echo ==========================================
echo               同步完成！
echo ==========================================
timeout /t 3 >nul
