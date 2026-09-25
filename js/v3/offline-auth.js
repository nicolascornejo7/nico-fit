import {cachedPublicConfig} from './public-config.js';

// Read the SDK's existing persisted session. Never copy its tokens to another key.
export function cachedV3Identity(storage=globalThis.localStorage){
  try{
    const config=cachedPublicConfig(storage);
    if(!config)return null;
    const ref=new URL(config.url).hostname.split('.')[0];
    const session=JSON.parse(storage.getItem(`sb-${ref}-auth-token`)||'null');
    const user=session?.user;
    if(!session?.access_token||!user?.id||!session?.expires_at||!Number.isFinite(Number(session.expires_at)))return null;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id))return null;
    return {id:user.id,email:typeof user.email==='string'?user.email:null,source:'offline-local'};
  }catch{return null;}
}
