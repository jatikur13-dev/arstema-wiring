import { useEffect, useRef, useState } from 'react'
import type { CircuitState } from '../../engine/engine'
import type { Terminal } from '../../engine/types'
import { assemblyStages, boardExploded, componentStage, normalizeBoard3DView, panelPlacement, type Board3DView, type PanelPlacement3D } from '../../engine/board3d'
import type { Board3DAxes, Board3DProjection, BoardScene } from './BoardScene'
import { ViewGizmo, SISI_3D } from './ViewGizmo'
import { operatingVisuals, terminalLabels } from './presentation'
import {componentAssets as assetIndex,componentAssetId,componentAsset} from './assetRegistry'
import { useContentPacks, useContentPackAsset } from '../../runtime/assets'
import { useWiringServices } from '../../runtime/services'
import { useBack } from '../../runtime/back'
import './Board3D.css'
import './Board3DControls.css'

export interface Board3DProps {
  state:CircuitState; view:Board3DView; onView(v:Board3DView):void; reduced:boolean;
  placing:boolean; erase:boolean; pending:Terminal|null;
  onSelect(id:string):void; onTerminal(t:Terminal):void; onWire(id:string):void;
  onPlace(x:number,y:number):void; onMove(id:string,p:PanelPlacement3D):void;
  onToggle(id:string):void; onPress(id:string,pressed:boolean):void;
  onProduct(id:string,control:'START'|'STOP'|'ACTUATOR',pressed:boolean):void;
  onResetOverload(id:string):void; onResetMcb(id:string):void;
  onDelete(id:string):void; onDeleteWire(id:string):void; onCancel():void;
  /** Local fixture only; production uses installed pack URLs. */
  assetUrls?:Record<string,string>;
}
export default function Board3DPanel(props:Board3DProps){
  const {assets:contentPackManager,onError}=useWiringServices()
  const latest=useRef(props);latest.current=props
  const host=useRef<HTMLDivElement>(null),scene=useRef<BoardScene>()
  const [error,setError]=useState(false),[ready,setReady]=useState(false),[attempt,retry]=useState(0),[fullscreen,setFullscreen]=useState(false),[urls,setUrls]=useState<Record<string,string>>({})
  const [assetState,setAssetState]=useState<'idle'|'loading'|'ready'|'error'>('idle'),[assetAttempt,retryAssets]=useState(0)
  const automatic=contentPackManager.delivery==='automatic'
  const {progress}=useContentPacks();const pack=progress.get('wiring-models-3d')?.state
  const assetIds=[...new Set(Object.values(props.state.board.components).map(c=>componentAssetId(c)||c.modelId||c.id))].sort().join('|')
  const view=normalizeBoard3DView(props.view),selected=props.state.board.components[view.selected]
  const exploded=boardExploded(props.state.board,view),editable=!exploded&&props.state.status!=='RUNNING'
  const levels=Math.max(0,...Object.values(props.state.board.components).map(c=>assemblyStages(c).length))
  const status=selected?operatingVisuals(props.state)[selected.id]:undefined
  const preview=useContentPackAsset('wiring-models-3d',selected?componentAsset(selected)?.preview:undefined)
  const index=assetIndex as Record<string,{path:string;label:string}>
  const patch=(change:Partial<Board3DView>)=>props.onView({...view,...change})
  useBack(125,()=>{if(!fullscreen)return false;setFullscreen(false);return true})
  useEffect(()=>{let active=true;setUrls({});if(props.assetUrls){setUrls(props.assetUrls);return}
    if(pack!=='installed'&&!automatic){setAssetState('idle');return}
    setAssetState('loading')
    void Promise.all(assetIds.split('|').filter(id=>index[id]).map(async id=>[id,await contentPackManager.assetUrl('wiring-models-3d',index[id].path)] as const)).then(values=>{if(active){setUrls(Object.fromEntries(values.filter((v):v is readonly [string,string]=>!!v[1])));setAssetState(values.some(v=>!v[1])?'error':'ready')}}).catch(error=>{if(active){setAssetState('error');onError(error);}})
    return()=>{active=false}
  },[assetIds,pack,props.assetUrls,automatic,assetAttempt])
  const [proyeksi,setProyeksi]=useState<Board3DProjection>(()=>props.view.camera?.projection??'orthographic')
  const [sumbu,setSumbu]=useState<Board3DAxes|null>(null)
  useEffect(()=>{let cancelled=false;setError(false);setReady(false)
    void import('./BoardScene').then(({createBoardScene})=>{if(cancelled||!host.current)return
      const updateView=(p:Partial<Board3DView>)=>{if(cancelled)return;const a=latest.current;a.onView({...a.view,...p})}
      scene.current=createBoardScene(host.current,{
        select(id){updateView({selected:id});latest.current.onSelect(id)},
        terminal(t){const p=latest.current;if(!boardExploded(p.state.board,p.view)&&p.view.mode==='wire'&&p.state.status!=='RUNNING')p.onTerminal(t)},
        wire(id){const p=latest.current;if(!boardExploded(p.state.board,p.view)&&p.state.status!=='RUNNING'){if(p.erase)p.onDeleteWire(id);else p.onWire(id)}},
        place(x,y){latest.current.onPlace(x,y)},move(id,p){latest.current.onMove(id,p)},
        assetError(){if(!cancelled)setAssetState('error')},camera(camera){updateView({camera})},
        projection(kind){if(!cancelled)setProyeksi(kind)},axes(a){if(!cancelled)setSumbu(a)},error(){if(cancelled)return;setError(true);setReady(false)},
      },latest.current.view.camera);setReady(true)
    }).catch(()=>{if(!cancelled)setError(true)})
    return()=>{scene.current?.dispose();cancelled=true;scene.current=undefined}
  },[attempt])
  useEffect(()=>{scene.current?.update({state:props.state,view,urls,reduced:props.reduced,placing:props.placing,editable})},[ready,props.state,props.view,urls,props.reduced,props.placing,editable])
  const mode=(m:Board3DView['mode'])=>{props.onCancel();patch({mode:m})}
  const hold=(control?:'START'|'STOP'|'ACTUATOR')=>{
    const send=(pressed:boolean)=>{if(!selected)return;if(control)props.onProduct(selected.id,control,pressed);else props.onPress(selected.id,pressed)}
    return {onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);send(true)},onPointerUp:()=>send(false),onPointerCancel:()=>send(false),onLostPointerCapture:()=>send(false),onBlur:()=>send(false),onKeyDown:(e:React.KeyboardEvent)=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();send(true)}},onKeyUp:(e:React.KeyboardEvent)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();send(false)}}}
  }
  return <section className={`board3d ${fullscreen?'board3d-full':''}`} aria-label="Papan 3D interaktif">
    <header><strong>Papan 3D</strong><span>GPU perangkat · edukasi</span></header>
    <div className="board3d-toolbar">
      <select aria-label="Mode papan 3D" value={view.mode} onChange={e=>mode(e.target.value as Board3DView['mode'])}>{([['navigate','Navigasi'],['operate','Operasikan'],['move','Pindah'],['wire','Sambung kabel']] as const).map(([m,label])=><option key={m} value={m} disabled={(m==='wire'||m==='move')&&!editable}>{label}</option>)}</select>
      <select aria-label="Sudut pandang 3D" value="" onChange={e=>scene.current?.side(e.target.value)}><option value="" disabled>Sudut</option>{SISI_3D.map(([s,l])=><option key={s} value={s}>{l}</option>)}</select>
      <button aria-label={proyeksi==='orthographic'?'Ganti ke perspektif':'Ganti ke ortografis'} aria-pressed={proyeksi==='orthographic'} className="board3d-proyeksi" title="Proyeksi (tombol 5)" onClick={()=>scene.current?.projection(proyeksi==='orthographic'?'perspective':'orthographic')}>{proyeksi==='orthographic'?'Orto':'Persp'}</button>
      <button aria-label="Pusatkan 3D" title="Pusatkan 3D" onClick={()=>scene.current?.fit()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8"/></svg></button>
      <button aria-label={fullscreen?'Tutup layar penuh':'Layar penuh 3D'} title={fullscreen?'Tutup layar penuh':'Layar penuh 3D'} aria-pressed={fullscreen} onClick={()=>setFullscreen(v=>!v)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={fullscreen?'M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5':'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'}/></svg></button>
    </div>
    {error?<div role="alert">GPU/WebGL2 tidak tersedia atau model gagal. Proyek tetap aman; gunakan Visual/IEC. Tidak memakai rendering server. <button onClick={()=>retry(n=>n+1)}>Coba 3D lagi</button></div>:!ready&&<p role="status">Menyiapkan renderer lokal…</p>}
    <div className="board3d-assets" role="status">
      {assetState==='loading'?'Memuat dan memverifikasi model…':assetState==='error'?<>Model gagal dimuat. <button onClick={()=>{retryAssets(n=>n+1);retry(n=>n+1)}}>Coba aset lagi</button></>:assetState==='idle'&&!automatic?<>Model belum terpasang. <button disabled={pack==='downloading'||pack==='queued'} onClick={()=>void contentPackManager.requestDownload(['wiring-models-3d'])}>{pack==='downloading'||pack==='queued'?'Mengunduh…':'Unduh model untuk offline'}</button></>:null}
    </div>
    <div className="board3d-viewport" style={{display:error?'none':undefined}}>
      <div className="board3d-stage" ref={host} aria-label="Kanvas panel 3D" />
      {/* Gizmo sumbu di pojok, seperti viewport Blender: menunjukkan arah papan
          sekarang, dan bisa diklik untuk melompat ke sisi itu. */}
      <ViewGizmo axes={sumbu} onPick={(sisi)=>scene.current?.side(sisi)} proyeksi={proyeksi} />
    </div>
    {(props.placing||props.pending||!editable)&&<p role="status">{props.placing?'Ketuk bidang kosong pada mode Operasikan. ':''}{props.pending?`Kabel dari ${props.pending.componentId} #${props.pending.index}. `:''}{!editable?'Rakit dan jeda sebelum mengedit.':''}</p>}
    <details className="board3d-details" open={!!selected||view.mode==='wire'}><summary>Komponen, bongkar & pengaturan{selected?` · ${selected.id}`:''}</summary><div className="board3d-inspector">
      <fieldset><legend>Lapisan global</legend><div className="board3d-tools board3d-stepper"><button aria-label="Lapis sebelumnya" title="Lapis sebelumnya" disabled={!view.level} onClick={()=>patch({level:Math.max(0,view.level-1)})}>−</button><output aria-label="Tahap global">{view.level} / {levels}</output><button aria-label="Lapis berikutnya" title="Lapis berikutnya" disabled={view.level>=levels} onClick={()=>patch({level:Math.min(levels,view.level+1)})}>+</button><button aria-label="Rakit semua" onClick={()=>patch({level:0,overrides:{}})}>Rakit</button></div>
        <label><input type="checkbox" checked={view.conceptual} onChange={e=>patch({conceptual:e.target.checked})}/> Bagian dalam</label>
        <label><input type="checkbox" checked={view.paths} disabled={!view.conceptual} onChange={e=>patch({paths:e.target.checked})}/> Jalur kontak dan beban</label>
        <label>Kualitas <select value={view.quality} onChange={e=>patch({quality:e.target.value as Board3DView['quality']})}><option value="auto">Otomatis</option><option value="low">Hemat GPU</option><option value="high">Detail tinggi</option></select></label>
      </fieldset>
      <fieldset><legend>Komponen & operasi</legend><label>Pilih komponen <select aria-label="Komponen 3D" value={selected?.id??''} onChange={e=>{patch({selected:e.target.value});props.onSelect(e.target.value)}}><option value="">Pilih…</option>{Object.values(props.state.board.components).map(c=><option key={c.id} value={c.id}>{c.id} · {index[c.modelId||'']?.label||c.spec.kind}</option>)}</select></label>
        {selected&&<>{preview&&<img src={preview} alt={`Katalog ${componentAsset(selected)?.label??selected.id}`} style={{width:'100%',height:120,objectFit:'contain'}}/>}<p><strong>{selected.id}</strong> · {status?.text} · <span>Tahap {componentStage(selected,view)} / {assemblyStages(selected).length}</span></p><button onClick={()=>scene.current?.focus(selected.id)}>Fokus komponen</button>
          <label>Tahap komponen <select aria-label="Tahap komponen" value={view.overrides[selected.id]===undefined?'global':view.overrides[selected.id]} onChange={e=>{const overrides={...view.overrides};if(e.target.value==='global')delete overrides[selected.id];else overrides[selected.id]=Number(e.target.value);patch({overrides})}}><option value="global">Ikuti global</option><option value="0">0 · Rakit</option>{assemblyStages(selected).map((name,i)=><option key={name} value={i+1}>{i+1} · {name}</option>)}</select></label>
          <p>{componentStage(selected,view)?assemblyStages(selected)[componentStage(selected,view)-1]:'Terakit'}{!view.conceptual?' · Aktifkan Bagian dalam untuk melihat isi komponen.':''}</p>
          <div className="board3d-tools">{selected.spec.kind==='PUSHBUTTON'?<button {...hold()}>Tekan / tahan</button>:selected.modelId==='PUSHBUTTON_STATION_XB5AL73415'?<><button {...hold('START')}>START</button><button {...hold('STOP')}>STOP</button></>:selected.modelId==='ILLUMINATED_PB_XB5AW33B5'?<button {...hold('ACTUATOR')}>Tekan / tahan</button>:['SWITCH','SWITCH_2WAY','SWITCH_CROSS','SELECTOR_3POS','CONTACT_2STATE','LIMIT_SWITCH','SENSOR_3WIRE','FUSE','ESTOP','BREAKER_1P','BREAKER_3P','TERMINAL_BLOCK'].includes(selected.spec.kind)?<button onClick={()=>props.onToggle(selected.id)}>Operasikan {selected.id}</button>:null}
            {selected.spec.kind==='OVERLOAD_RELAY'&&<button onClick={()=>props.onResetOverload(selected.id)}>Reset overload</button>}{selected.spec.kind.startsWith('BREAKER')&&<button onClick={()=>props.onResetMcb(selected.id)}>Reset MCB</button>}
            <button disabled={!editable} onClick={()=>props.onMove(selected.id,{...panelPlacement(selected,view),rotation:(panelPlacement(selected,view).rotation+90)%360})}>Putar pemasangan 90°</button><button disabled={!editable} onClick={()=>props.onDelete(selected.id)}>Hapus komponen</button></div>
          <div hidden={view.mode!=='wire'}><p>Terminal logis</p><div className="board3d-tools">{terminalLabels(selected).map((label,index)=><button key={index} disabled={!editable||view.mode!=='wire'} onClick={()=>props.onTerminal({componentId:selected.id,index})}>{selected.id} · {label}</button>)}</div></div>
        </>}
      </fieldset>
    </div></details>
    <details className="board3d-help"><summary>Bantuan</summary><p>Geser pada mode Navigasi untuk memutar; cubit/roda untuk zoom. Klik gizmo sumbu di pojok kanvas untuk melompat ke sisi papan. Dengan kanvas terpilih: <kbd>1</kbd> depan, <kbd>3</kbd> kanan, <kbd>7</kbd> atas (tahan Ctrl untuk sisi seberang), <kbd>9</kbd> seberang, <kbd>5</kbd> tukar perspektif/ortografis, <kbd>0</kbd> isometrik, <kbd>F</kbd> muat seluruh papan. Terminal menunjukkan hubungan logis, bukan titik pemasangan fisik. Penanda status menunjukkan komponen aktif. Panah DC menunjukkan arah konvensional; titik AC menelusuri jalur aktif, bukan arah arus sesaat.</p><p className="board3d-asset-status">{assetState==='ready'?'Aset terverifikasi · rendering pada perangkat.':'Penanda komponen sementara; model belum siap.'}</p></details>
  </section>
}
