@echo off
REM Deploy v89 - fix boton guardar seguimiento trabado en "Guardado"
cd /d C:\Users\PERSONAL\Geat-visitas

echo === Sincronizando index.html con index_v52.html ===
copy /Y index_v52.html index.html

echo === Verificando version ===
findstr /C:"CURRENT_VERSION='89'" index.html >nul && echo OK: CURRENT_VERSION=89 en index.html || echo ATENCION: revisar CURRENT_VERSION
type version.json

echo === Git add / commit / push ===
git add index.html version.json index_v52.html
git commit -m "v89: fix boton guardar seguimiento trabado en Guardado"
git push origin main

echo === LISTO ===
pause
