// PREPARED ONLY. Run manually on the exact origin after creating a fresh local
// backup. Existing Nico Fit local stores are replaced only after typed consent.
(async()=>{
  const phrase='RESTORE AND REPLACE LOCAL NICO FIT DATA';
  if(prompt(`Type exactly: ${phrase}`)!==phrase)throw new Error('Restore cancelled.');
  const input=document.createElement('input');input.type='file';input.accept='application/json';input.click();
  const file=await new Promise((resolve,reject)=>{input.onchange=()=>input.files?.[0]?resolve(input.files[0]):reject(new Error('No file selected.'));});
  const payload=JSON.parse(await file.text());
  if(payload.kind!=='nico-fit-local-backup'||payload.format_version!==1)throw new Error('Unsupported backup format.');
  if(payload.origin!==location.origin)throw new Error(`Origin mismatch: ${payload.origin}`);
  const request=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
  for(const database of payload.indexed_db||[]){
    if(!database.name?.startsWith('nico-fit-v3-local:'))throw new Error('Unexpected IndexedDB name.');
    const db=await request(indexedDB.open(database.name));
    for(const [name,records] of Object.entries(database.stores||{})){
      if(!db.objectStoreNames.contains(name))throw new Error(`Missing store ${name}; open the matching client version first.`);
      const tx=db.transaction(name,'readwrite'),store=tx.objectStore(name);store.clear();for(const row of records)store.put(row);await transaction(tx);
    }
    db.close();
  }
  for(const item of payload.local_storage||[]){
    if(!(item.key==='gymFutbolAppV1'||item.key==='gymFutbolAppV2'||item.key.startsWith('gymFutbolAppV2:')||item.key.startsWith('nicoFit.v3.')||item.key.startsWith('v3.')))throw new Error('Unexpected localStorage key.');
    localStorage.setItem(item.key,item.value);
  }
  console.info('Nico Fit local restore completed. Reload and validate while offline before enabling sync.');
})().catch(error=>console.error('Nico Fit local restore failed',error));
