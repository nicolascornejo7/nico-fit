export const AUTHORIZED_V3_URLS=Object.freeze([
  'https://tmydirzzlmlmtjgwqcgh.supabase.co',
  'https://xaklsoqyzwowtjwcpwmb.supabase.co'
]);
const allowed=new Set(AUTHORIZED_V3_URLS);

export function assertAuthorizedV3Url(value){
  let url;try{url=new URL(value);}catch{throw new Error('El destino V3 no es una URL válida.');}
  if(value!==url.origin||url.protocol!=='https:'||!allowed.has(url.origin))throw new Error('El destino V3 no está autorizado.');
  return url.origin;
}

export function assertAuthorizedV3Client(client){
  assertAuthorizedV3Url(client?.supabaseUrl);
  const key=client?.supabaseKey;if(!key||key.startsWith('sb_secret_'))throw new Error('Publishable key required.');
  if(key.split('.').length===3){const payload=JSON.parse(globalThis.atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(payload.role!=='anon')throw new Error('Service role forbidden.');}
  return client;
}
