const collections=['workouts','sessions','readiness','football','matches'];
const clone=value=>structuredClone(value);

// Read-only boundary for the frozen V2 history. It deliberately receives only
// a snapshot getter and exposes no mutation, synchronization or deletion API.
export class V2HistoryReader{
  constructor({getData}={}){if(typeof getData!=='function')throw new Error('V2 history snapshot getter required.');this.getData=getData;}
  async read(){
    const source=await this.getData(),result={};
    for(const name of collections)result[name]=Array.isArray(source?.[name])?clone(source[name]):[];
    return result;
  }
}

export const V2_HISTORY_COLLECTIONS=Object.freeze([...collections]);
