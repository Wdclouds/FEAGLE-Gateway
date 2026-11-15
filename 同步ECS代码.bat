@echo off
chcp 65001 >nul
echo ========================================================
echo   FEAGLE-Gateway 本地与 ECS 代码双向同步工具
echo ========================================================
echo.

set GIT_PATH=git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 系统未找到 git 命令，请确认 Git 是否已安装并配置 PATH。
    pause
    exit /b 1
)

echo [1/3] 正在从 ECS 服务器拉取最新提交与分支...
git pull --rebase ecs main
if %errorlevel% neq 0 (
    echo [警告] 拉取冲突或失败，请检查网络或冲突文件。
    pause
    exit /b 1
)
echo      拉取成功！
echo.

echo [2/3] 检查本地更改...
git status -s
echo.

echo [3/3] 将本地代码同步推送至 ECS 服务器...
git push ecs main
if %errorlevel% neq 0 (
    echo [提示] 推送跳过或报错（若本地无新提交属正常）。
) else (
    echo      推送成功！ECS 服务器端工作区已自动更新为最新代码。
)

echo.
echo ========================================================
echo   同步完成！按任意键退出...
echo ========================================================
pause >nul
