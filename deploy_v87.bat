@echo off
cd /d C:\Users\PERSONAL\Geat-visitas
> deploy_log_v87.txt echo === DEPLOY v87 START ===
echo --- copy index_v52.html to index.html --- >> deploy_log_v87.txt
copy /Y index_v52.html index.html >> deploy_log_v87.txt 2>&1
echo --- fc binary compare --- >> deploy_log_v87.txt
fc /b index_v52.html index.html >> deploy_log_v87.txt 2>&1
if errorlevel 1 (
  echo COPY_MISMATCH_ABORT_NO_PUSH >> deploy_log_v87.txt
  echo === DEPLOY v87 END === >> deploy_log_v87.txt
  goto end
)
echo COPY_OK_IDENTICAL >> deploy_log_v87.txt
echo --- version.json --- >> deploy_log_v87.txt
type version.json >> deploy_log_v87.txt 2>&1
echo. >> deploy_log_v87.txt
echo --- git add --- >> deploy_log_v87.txt
git add index.html version.json >> deploy_log_v87.txt 2>&1
echo --- git commit --- >> deploy_log_v87.txt
git commit -m "v87: fix contexto fechas asistente" >> deploy_log_v87.txt 2>&1
echo --- git HEAD hash --- >> deploy_log_v87.txt
git rev-parse HEAD >> deploy_log_v87.txt 2>&1
echo --- git push --- >> deploy_log_v87.txt
git push origin main >> deploy_log_v87.txt 2>&1
echo PUSH_ERRORLEVEL=%ERRORLEVEL% >> deploy_log_v87.txt
echo === DEPLOY v87 END === >> deploy_log_v87.txt
:end
