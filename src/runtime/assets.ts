import {useEffect,useState,useSyncExternalStore} from 'react';
import {useWiringServices} from './services';
export function useContentPacks(){const {assets:manager,onError}=useWiringServices();const progress=useSyncExternalStore(manager.subscribe,manager.snapshot,manager.snapshot);useEffect(()=>{void manager.initialize().catch(onError);},[manager,onError]);return {manager,progress};}
export function useContentPackAsset(packId:string,path:string|undefined){
 const {manager,progress}=useContentPacks(),{onError}=useWiringServices();const state=progress.get(packId)?.state,fileState=progress.get(`file:${packId}:${path}`)?.state;
 const [asset,setAsset]=useState<{packId:string;path:string;url:string}>();
 useEffect(()=>{let active=true;setAsset(undefined);if(path)void manager.assetUrl(packId,path).then(url=>{if(active&&url)setAsset({packId,path,url});}).catch(onError);return()=>{active=false;};},[manager,packId,path,state,fileState,onError]);
 return asset?.packId===packId&&asset.path===path?asset.url:undefined;
}
