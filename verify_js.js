// verify_js.js — extrae el <script> inline del HTML y valida su sintaxis (equivalente a node --check)
const fs = require('fs');
const vm = require('vm');
const file = process.argv[2] || 'index_v52.html';
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!m) { console.error('No se encontro el bloque <script> inline en ' + file); process.exit(2); }
try {
  new vm.Script(m[1]); // lanza SyntaxError si el JS es invalido
  console.log('JS OK (' + file + ')');
} catch (e) {
  console.error('JS ERROR en ' + file + ': ' + e.message);
  process.exit(1);
}
