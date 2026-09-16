// Run manually in DevTools on the exact installed-PWA origin. This downloads
// Nico Fit local data only; it never sends data over the network.
(async()=>{
  const request=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
  const local=[];
  for(let index=0;index<localStorage.length;index++){
    const key=localStorage.key(index);
    if(key==='gymFutbolAppV1'||key==='gymFutbolAppV2'||key?.startsWith('gymFutbolAppV2:')||key?.startsWith('nicoFit.v3.')||key?.startsWith('v3.'))local.push({key,value:localStorage.getItem(key)});
  }
  const databases=[];
  for(const info of await indexedDB.databases()){
    if(!info.name?.startsWith('nico-fit-v3-local:'))continue;
    const db=await request(indexedDB.open(info.name));
    const stores={};
    for(const name of db.objectStoreNames){const tx=db.transaction(name,'readonly');stores[name]=await request(tx.objectStore(name).getAll());await transaction(tx);}
    databases.push({name:info.name,version:db.version,stores});db.close();
  }
  const payload={kind:'nico-fit-local-backup',format_version:1,created_at:new Date().toISOString(),origin:location.origin,local_storage:local,indexed_db:databases};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=`nico-fit-local-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  console.info('Nico Fit local backup downloaded. Store it encrypted and compute a SHA-256 checksum.');
})().catch(error=>console.error('Nico Fit local backup failed',error));
