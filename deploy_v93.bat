@echo off
cd /d "C:\Users\PERSONAL\Geat-visitas"
echo === DEPLOY v93 %DATE% %TIME% === > deploy_log.txt
copy /Y index_v52.html index.html >> deploy_log.txt 2>&1
git add -A >> deploy_log.txt 2>&1
git commit -m "v93: formulario agendar visita + mensaje copiable WhatsApp" >> deploy_log.txt 2>&1
echo --- PUSH --- >> deploy_log.txt 2>&1
git push >> deploy_log.txt 2>&1
echo === FIN EXITCODE %ERRORLEVEL% === >> deploy_log.txt 2>&1
