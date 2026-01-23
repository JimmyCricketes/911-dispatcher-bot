@echo off
echo ===============================================
echo Push TypeScript Bot to GitHub
echo ===============================================

set GIT_PATH=C:\Program Files\Git\cmd
set PATH=%GIT_PATH%;%PATH%

cd /d "c:\Program Files\Git\Awesome-Sauce\roblox\discord-whitelist"

echo.
echo Setting up remote...
call git init 2>nul
call git remote remove origin 2>nul
call git remote add origin https://github.com/JimmyCricketes/911-dispatcher-bot.git

echo.
echo Remote set to: https://github.com/JimmyCricketes/911-dispatcher-bot.git

echo.
echo ===============================================
echo Adding all files...
echo ===============================================
call git add .

echo.
echo Files to be committed:
call git status --short

echo.
echo ===============================================
echo Committing changes...
echo ===============================================
call git commit -m "Convert bot to TypeScript with bloom filter duplicate detection"

echo.
echo ===============================================
echo Pushing to GitHub (main branch)...
echo ===============================================
call git branch -M main
call git push -u origin main --force

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===============================================
    echo SUCCESS! Pushed to GitHub
    echo https://github.com/JimmyCricketes/911-dispatcher-bot
    echo ===============================================
) else (
    echo.
    echo If push failed, you may need to authenticate.
    echo Try running: git push -u origin main
    echo Or use GitHub Desktop to push.
)

echo.
pause
