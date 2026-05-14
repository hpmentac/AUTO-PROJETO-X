@echo off
chcp 65001 >nul
title AUTO VIDEO — Webhook Server

cd /d "%~dp0"

echo.
echo  ══════════════════════════════════════════════════════
echo   AUTO VIDEO  ^|  Webhook Server
echo   Porta: 5580   ^|  http://localhost:5580
echo  ══════════════════════════════════════════════════════
echo.
echo   Endpoints disponiveis:
echo     POST  /webhook/roteiro    recebe roteiro para processar
echo     POST  /scheduler/flush    forca processamento do batch
echo     GET   /health             verifica se esta rodando
echo     GET   /status             fila e status detalhado
echo.
echo  ══════════════════════════════════════════════════════
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [AVISO] node_modules ausente. Instalando dependencias...
    echo.
    npm install
    echo.
)

if not exist ".env" (
    echo  [ERRO] Arquivo .env nao encontrado.
    echo         Crie o .env com TALKIFY_API_KEY antes de iniciar.
    pause
    exit /b 1
)

node src/webhook-server.js

echo.
echo  [ENCERRADO] Pressione qualquer tecla para fechar.
pause >nul
