@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo     Terminal AI Agent Setup (Aider)
echo ===================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python first.
    pause
    exit /b
)

:: Check if Aider is installed
aider --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Aider is not installed. Installing Aider via pip...
    pip install aider-chat
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install Aider.
        pause
        exit /b
    )
    echo [INFO] Aider installed successfully!
)

:: Prompt for API keys
set /p NVIDIA_KEY="Enter your NVIDIA API Key (starts with nvapi-, press Enter to skip if already set or not using): "
if not "!NVIDIA_KEY!"=="" (
    setx OPENAI_API_BASE "https://integrate.api.nvidia.com/v1"
    setx OPENAI_API_KEY "!NVIDIA_KEY!"
    set OPENAI_API_BASE=https://integrate.api.nvidia.com/v1
    set OPENAI_API_KEY=!NVIDIA_KEY!
    echo [INFO] NVIDIA API key saved for your user profile!
)

set /p ANTHROPIC_KEY="Enter your Anthropic API Key for Claude Sonnet (starts with sk-ant-, press Enter to skip): "
if not "!ANTHROPIC_KEY!"=="" (
    setx ANTHROPIC_API_KEY "!ANTHROPIC_KEY!"
    set ANTHROPIC_API_KEY=!ANTHROPIC_KEY!
    echo [INFO] Anthropic API key saved for your user profile!
)

echo.
echo ===================================================
echo     Choose which model you want to run:
echo ===================================================
echo 1) NVIDIA API: Llama 3.3 70B (Requires NVIDIA API Key)
echo 2) Anthropic API: Claude 3.5 Sonnet (Requires Anthropic API Key)
echo 3) Just start Aider (Will use Claude 3.5 Sonnet if Anthropic key is set, else GPT-4o)
echo.

set /p choice="Enter your choice (1/2/3): "

if "!choice!"=="1" (
    echo Starting Aider with NVIDIA Llama 3.3 70B...
    aider --model openai/meta/llama-3.3-70b-instruct
) else if "!choice!"=="2" (
    echo Starting Aider with Claude 3.5 Sonnet...
    aider --model sonnet
) else (
    echo Starting Aider with default settings...
    aider
)

pause
