@echo off
REM Deploy v91 - captura de audio del sistema (lo que suena en la PC)
cd /d C:\Users\PERSONAL\Geat-visitas

echo === [1/4] Verificando JS (node) ===
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  node verify_js.js index_v52.html
  if errorlevel 1 ( echo ERROR: JS invalido o no extraible. Abortando deploy. & pause & exit /b 1 )
) else (
  echo node no encontrado: se OMITE la verificacion JS. Revisa manualmente.
)

echo === [2/4] Sincronizando index.html con index_v52.html ===
copy /Y index_v52.html index.html

echo === [3/4] Verificando version v91 ===
findstr /C:"CURRENT_VERSION='91'" index.html >nul && echo OK: CURRENT_VERSION=91 || echo ATENCION: revisar CURRENT_VERSION
type version.json

echo === [4/4] git add / commit / push ===
git add index.html version.json index_v52.html
git commit -m "v91: captura de audio del sistema (lo que suena en la PC)"
git push origin main

echo === VERIFICACION POST-PUSH ===
echo --- git log -1 --oneline ---
git log -1 --oneline
echo --- version.json ---
type version.json
echo --- SHA completo ---
git rev-parse HEAD
echo --- estado vs remoto ---
git status -sb

echo === LISTO v91 ===
pause
