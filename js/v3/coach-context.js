import {loadLocalData} from '../store.js';
import {isV3SignalsEnabled} from './feature-flags.js';
import {V3SignalsRepository} from './signals-repository.js';

// Explicit source selection, never a fallback to V2 when V3 is enabled.
export async function coachContextFor(repository){return isV3SignalsEnabled()?new V3SignalsRepository({repository}).coachContext():loadLocalData(repository.userId);}
