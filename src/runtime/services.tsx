import {createContext,useContext} from 'react';
import {defaultStorage,type WiringStorage} from './storage';
export interface AssetProgress {state:string}
export interface WiringAssets {
 delivery?: 'download' | 'automatic';
 subscribe(listener:()=>void):()=>void;
 snapshot():ReadonlyMap<string,AssetProgress>;
 initialize():Promise<unknown>;
 assetUrl(packId:string,path:string):Promise<string|undefined>;
 requestDownload(ids:readonly string[]):Promise<boolean>;
}
const empty=new Map<string,AssetProgress>();
export const NO_ASSETS:WiringAssets={subscribe:()=>()=>{},snapshot:()=>empty,initialize:async()=>{},assetUrl:async()=>undefined,requestDownload:async()=>false};
export interface WiringBack {register(priority:number,handler:()=>boolean):()=>void;dispatch():boolean;captureEditor():void}
export function createBack(owns:(element:Element|null)=>boolean=()=>true):WiringBack {
 const entries:{priority:number;handler:()=>boolean}[]=[];let editor:HTMLElement|null=null;
 const focused=()=>typeof document==='undefined'?null:document.activeElement;
 const editable=(el:Element|null)=>owns(el)&&typeof HTMLElement!=='undefined'&&el instanceof HTMLElement&&(el.matches('textarea,[contenteditable=true]')||el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=file])'));
 return {register(priority,handler){const entry={priority,handler};entries.push(entry);return()=>{const i=entries.indexOf(entry);if(i>=0)entries.splice(i,1);};},captureEditor(){const el=focused();editor=editable(el)?el as HTMLElement:null;},dispatch(){const el=editor??focused();editor=null;if(editable(el)){(el as HTMLElement).blur();return true;}return [...entries].reverse().sort((a,b)=>b.priority-a.priority).some(e=>e.handler());}};
}
export interface WiringServices {storage:WiringStorage;assets:WiringAssets;back:WiringBack;active:boolean;notify(message:string):void;onError(error:Error):void;ownsEvent(event:Event):boolean}
export const defaultServices:WiringServices={storage:defaultStorage,assets:NO_ASSETS,back:createBack(),active:true,notify:()=>{},onError:()=>{},ownsEvent:()=>true};
export const ServicesContext=createContext(defaultServices);
export const useWiringServices=()=>useContext(ServicesContext);
