import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.NICO_FIT_LOCAL_PORT||41747);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Puerto local inválido.');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.png':'image/png'};
createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://127.0.0.1').pathname;
  const relative=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/, '');
  const target=resolve(root,relative);
  if(!target.startsWith(root+sep)||!types[target.slice(target.lastIndexOf('.'))]){response.writeHead(404).end();return;}
  try{const content=await readFile(target);response.writeHead(200,{'Content-Type':types[target.slice(target.lastIndexOf('.'))],'Cache-Control':'no-store'}).end(content);}
  catch{response.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log(`Inventario local: http://127.0.0.1:${port}/local-device-inventory.html`));
