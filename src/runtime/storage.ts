export const WIRING_PROJECT_STORAGE_KEY='app:wiring:project:v1';
export interface WiringStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const memory=new Map<string,string>();
export const getItem=(key:string):string|null=>typeof localStorage==='undefined'?memory.get(key)??null:localStorage.getItem(key);
export const setItemDurable=(key:string,value:string):void=>{if(typeof localStorage==='undefined')memory.set(key,value);else localStorage.setItem(key,value);};
export const replaceMemory=(entries:Iterable<readonly [string,string]>)=>{memory.clear();for(const [k,v] of entries)memory.set(k,v);};
export const defaultStorage:WiringStorage={getItem,setItem:setItemDurable};
export function browserStorage(namespace:string):WiringStorage {
 if(!namespace.trim())throw Error('Storage namespace is required');
 return {getItem:key=>getItem(`${namespace}:${key}`),setItem:(key,value)=>setItemDurable(`${namespace}:${key}`,value)};
}
