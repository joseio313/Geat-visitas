const fs=require('fs');
const vm=require('vm');
const p='C:\\Users\\PERSONAL\\Geat-visitas\\index_v52.html';
const out='C:\\Users\\PERSONAL\\Geat-visitas\\validate_log.txt';
try{
  const html=fs.readFileSync(p,'utf8');
  const i=html.indexOf('<script>');
  if(i<0){fs.writeFileSync(out,'FAIL: no bare <script> found');process.exit(1);}
  const start=i+'<script>'.length;
  const end=html.indexOf('</script>',start);
  const js=html.slice(start,end);
  new vm.Script(js);
  const hasFns=['abrirAgendarVisita','toggleLugarVisita','guardarAgendarVisita','copiarAgendarVisitaWa']
    .filter(n=>js.indexOf('function '+n)>=0);
  fs.writeFileSync(out,'PASS: JS syntax OK | length='+js.length+' | fns='+hasFns.join(',')+' | ver='+(html.indexOf("CURRENT_VERSION='93'")>=0?'93':'??'));
}catch(e){
  fs.writeFileSync(out,'FAIL: '+e.message+'\n'+(e.stack||''));
}
