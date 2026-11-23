import {forwardRef,useEffect,useMemo,useRef,useState} from 'react';
import {WiringRoom,type WiringHandle,type WiringChrome} from './ui/WiringRoom';
import {ServicesContext,createBack,type WiringServices,type WiringAssets,type WiringBack} from './runtime/services';
import {createAutomaticAssets} from './runtime/automaticAssets';
export {createAutomaticAssets} from './runtime/automaticAssets';
import {browserStorage,type WiringStorage} from './runtime/storage';
import type {CircuitProject} from './engine/index';
import './styles.css';
export type {WiringHandle,WiringAssets,WiringBack,WiringStorage,CircuitProject,WiringChrome};
export interface WiringAppProps {namespace?:string;storage?:WiringStorage;assets?:WiringAssets;
 /** Salinan paket aset milik tuan rumah, mis. '/wiring/paket/'. Tanda tangan dan checksum tetap diperiksa. */
 assetMirror?:string;back?:WiringBack;active?:boolean;mode?:'embedded'|'overlay';onClose?:()=>void;onChange?:(project:CircuitProject)=>void;onError?:(error:Error)=>void;
 /** Bagian bingkai yang sudah disediakan tuan rumah (tombol kembali, panel proyek, tombol zoom). */
 chrome?:WiringChrome}
/** Configure namespace/services once per mounted instance. Remount to change tenant. */
export const WiringApp=forwardRef<WiringHandle,WiringAppProps>(function WiringApp(props,ref){
 const root=useRef<HTMLDivElement>(null),[notice,setNotice]=useState('');
 const [base]=useState(()=>({storage:props.storage??browserStorage(props.namespace??'arstema:wiring:default'),assets:props.assets??createAutomaticAssets(props.assetMirror),back:props.back??createBack(el=>!!root.current?.contains(el))}));
 const disposal=useRef<ReturnType<typeof setTimeout>>();
 useEffect(()=>{clearTimeout(disposal.current);return()=>{disposal.current=setTimeout(()=>{if(!props.assets&&'dispose' in base.assets)(base.assets as ReturnType<typeof createAutomaticAssets>).dispose()},0)}},[base]);
 const runtime=useMemo<WiringServices>(()=>({...base,active:props.active!==false,notify:setNotice,onError:error=>{setNotice(error.message||'Wiring mengalami kendala.');props.onError?.(error);},ownsEvent:event=>!!root.current?.contains(event.target as Node)}),[base,props.active,props.onError]);
 return <ServicesContext.Provider value={runtime}><div ref={root} className="arstema-wiring" data-mode={props.mode??'embedded'} hidden={props.active===false} tabIndex={-1}>
 <WiringRoom ref={ref} onClose={props.onClose??(()=>{})} onChange={props.onChange} chrome={props.chrome}/>{notice&&<div className="wiring-notice" role="status"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Tutup pemberitahuan wiring">×</button></div>}
 </div></ServicesContext.Provider>;
});
