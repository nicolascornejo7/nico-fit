import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const server=createServer(async(request,response)=>{
  const match=request.url?.match(/^\/v3-staging-(apply|[1-8])\.sql$/);
  if(!match){
    response.writeHead(404).end('Not found');
    return;
  }
  try{
    const sql=await readFile(new URL(`../.tmp/v3-staging-${match[1]}.sql`,import.meta.url),'utf8');
    response.writeHead(200,{
      'Content-Type':'text/plain; charset=utf-8',
      'Cache-Control':'no-store',
      'Access-Control-Allow-Origin':'*'
    });
    response.end(sql);
  }catch(error){
    response.writeHead(500).end(error.message);
  }
});

server.listen(41739,'127.0.0.1',()=>console.log('V3 staging bundle available on loopback port 41739.'));
