@echo off
chcp 65001 >nul
title AUTO VIDEO - Conversor de Assets 16:9 para 9:16
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   AUTO VIDEO  -  Conversor de Assets  (16:9 para 9:16)
echo   Saida: _converted\ dentro da pasta escolhida
echo  ===========================================================
echo.

:: Verifica Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
    pause & exit /b 1
)

:: Verifica FFmpeg
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] FFmpeg nao encontrado no PATH.
    pause & exit /b 1
)

:: ── Detecta a pasta a converter ────────────────────────────────────────────
::
:: Prioridade:
::   1. Pasta arrastada sobre o .bat (argumento %1)
::   2. DEFAULT_BACKGROUNDS_DIR no .env
::   3. Pergunta ao usuario

set "PASTA="

:: [1] Argumento arrastado sobre o bat
if not "%~1"=="" (
    set "PASTA=%~1"
    echo  Pasta recebida por argumento: %~1
    goto :converter
)

:: [2] Le DEFAULT_BACKGROUNDS_DIR do .env
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /i "%%A"=="DEFAULT_BACKGROUNDS_DIR" (
            if not "%%B"=="" set "PASTA=%%B"
        )
    )
)

if not "%PASTA%"=="" (
    echo  Pasta detectada do .env: %PASTA%
    goto :converter
)

:: [3] Pede ao usuario (fallback)
echo  Nenhuma pasta configurada no .env.
echo  Arraste a pasta de backgrounds sobre este .bat  OU
set /p "PASTA=  Digite o caminho da pasta: "
set "PASTA=%PASTA:"=%"

if "%PASTA%"=="" (
    echo.
    echo  [ERRO] Nenhuma pasta informada. Configure DEFAULT_BACKGROUNDS_DIR no .env
    pause & exit /b 1
)

:converter
:: Remove barra final se houver
if "%PASTA:~-1%"=="\" set "PASTA=%PASTA:~0,-1%"

if not exist "%PASTA%" (
    echo.
    echo  [ERRO] Pasta nao encontrada: %PASTA%
    pause & exit /b 1
)

echo.
echo  Convertendo arquivos em:
echo  %PASTA%
echo.

node scripts/convert-assets.js "%PASTA%"

echo.
if errorlevel 1 (
    echo  [CONCLUIDO COM ERROS] Veja as mensagens acima.
) else (
    echo  [OK] Arquivos convertidos em: %PASTA%\_converted\
)
echo.
pause
