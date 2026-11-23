import { wirePresentation } from '../../engine/wirePresentation'
import { componentAsset, componentAssetId } from './assetRegistry'
import { routeCables } from './routeCables'
import * as T from 'three'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CircuitState } from '../../engine/engine'
import type { Terminal } from '../../engine/types'
import { assemblyStages, componentStage, panelPlacement, type Board3DView, type PanelCamera3D, type PanelPlacement3D } from '../../engine/board3d'
import { operatingVisuals, terminalLabels, terminalPoint } from './presentation'
import { transition, sampleTransition, rotorStep, type Transition } from '../../runtime/motion'
import { cableCurve } from './cableGeometry'

export interface SceneInput { state: CircuitState; view: Board3DView; urls: Record<string,string>; reduced: boolean; placing: boolean; editable: boolean }
interface Callbacks { select(id: string): void; terminal(t: Terminal): void; wire(id: string): void; place(x:number,y:number): void; move(id:string,p:PanelPlacement3D):void; camera(c:PanelCamera3D):void; projection?(kind:Board3DProjection):void; axes?(a:Board3DAxes):void; error():void; assetError?(id:string):void }
type Unit = { group:T.Group; layers:T.Group[]; rotor:T.Group; lever:T.Group; indicator:T.Mesh; labels: {node:T.Object3D; el:HTMLButtonElement; pin:boolean}[]; paths:T.Group; pathKey:string; level:number; levelMotion:Transition; leverMotion:Transition; loaded?:T.Group; anchors:Map<number,T.Vector3> }
export type Board3DProjection = 'perspective' | 'orthographic'
/** Arah sumbu dunia yang sudah diproyeksikan ke layar, untuk gizmo sudut. */
export interface Board3DAxes { x:[number,number,number]; y:[number,number,number]; z:[number,number,number] }
export interface BoardScene { update(input:SceneInput):void; side(side:string):void; zoom(factor:number):void; fit():void; focus(id:string):void; projection(kind:Board3DProjection):void; dispose():void }

/** One GPU scene per board, local assets only. No electrical state machine. */
export function createBoardScene(host:HTMLDivElement, cb:Callbacks, saved?:PanelCamera3D):BoardScene {
  /* Kanvas dibiarkan tembus pandang supaya dasar panggung datang dari CSS
     (.board3d-stage), satu tempat saja — situs yang memasang Wiring cukup
     mengganti palet, tanpa warna kembar di dalam kode render. */
  const renderer=new T.WebGLRenderer({antialias:true,alpha:true})
  renderer.setClearColor(0x000000,0); renderer.outputColorSpace=T.SRGBColorSpace
  const canvas=renderer.domElement; canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none'; canvas.tabIndex=0
  host.appendChild(canvas)
  const scene=new T.Scene()
  /* Dua kamera, satu layar — seperti viewport Blender. Perspektif untuk
     merasakan ruang; ortografis untuk MEMBACA papan: garis sejajar tetap
     sejajar, jadi jarak antar komponen bisa dibandingkan dengan mata. Sudut
     isometrik hanya jujur pada kamera ortografis, karena itu keduanya ada. */
  const perspektif=new T.PerspectiveCamera(38,1,.01,100000)
  const ortografis=new T.OrthographicCamera(-1,1,1,-1,.01,100000)
  perspektif.up.set(0,1,0); ortografis.up.set(0,1,0)
  let camera:T.PerspectiveCamera|T.OrthographicCamera=perspektif
  let proyeksi:Board3DProjection='perspective'
  const controls=new TrackballControls(camera,canvas); controls.staticMoving=true; controls.rotateSpeed=2; controls.minDistance=.5; controls.maxDistance=1e6
  scene.add(new T.HemisphereLight(0xe8f4ff,0x596679,3))
  const light=new T.DirectionalLight(0xffffff,3);light.position.set(10,20,40);scene.add(light)
  const fill=new T.DirectionalLight(0xffffff,2);fill.position.set(-20,-10,-30);scene.add(fill)
  const box=new T.BoxGeometry(1,1,1), sphere=new T.SphereGeometry(.10,8,6), cylinder=new T.CylinderGeometry(.55,.55,.12,18)
  const materials=new Map<string,T.MeshStandardMaterial>()
  function mat(color:string){let m=materials.get(color);if(!m){m=new T.MeshStandardMaterial({color,roughness:.6,metalness:.15});materials.set(color,m)}return m}
  const flowGroup=new T.Group(), flowGeometry=new T.ConeGeometry(.11,.3,6), pulseGeometry=new T.SphereGeometry(.11,6,4), flowMaterial=new T.MeshBasicMaterial({color:0xffffc2,depthTest:false})
  let cachedRoutes:Map<string,T.Vector3[]>|undefined
  const cablePaths=new Map<string,T.CurvePath<T.Vector3>>(), markers=new Map<string,T.Mesh[]>();let signals:ReturnType<typeof wirePresentation>={}
  const units=new Map<string,Unit>(), wires=new T.Group(), panel=new T.Mesh(box,mat('#253a49'))
  scene.add(wires,panel,flowGroup)
  let input:SceneInput|undefined, signature='', disposed=false, frame=0, dirty=true, initialized=false, lastRender=0, slowFrames=0, adaptiveLow=false, pixelRatio=0
  let saveTimer:ReturnType<typeof setTimeout>|undefined
  let interacting=false, lastTick:number|undefined
  function wake(){if(!disposed&&!document.hidden&&!frame)frame=requestAnimationFrame(tick)}
  function invalidate(){dirty=true;wake()}
  const center=new T.Vector3(), size=new T.Vector3(10,10,5)
  const models=new Map<string,Promise<T.Group|undefined>>(), loadedResources:T.Group[]=[]
  const ray=new T.Raycaster(), pointer=new T.Vector2(), workplane=new T.Plane(new T.Vector3(0,0,1),0)
  function shape(parent:T.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string){const o=new T.Mesh(box,mat(color));o.position.set(x,y,z);o.scale.set(sx,sy,sz);parent.add(o);return o}
  function persist(){if(initialized&&!disposed)cb.camera({position:camera.position.toArray() as [number,number,number],target:controls.target.toArray() as [number,number,number],up:camera.up.toArray() as [number,number,number],projection:proyeksi})}
  function changed(){invalidate();kirimSumbu();clearTimeout(saveTimer);saveTimer=setTimeout(persist,180)}
  controls.addEventListener('change',changed)
  const beginControls=()=>{interacting=true;wake()}, endControls=()=>{interacting=false;wake()}
  controls.addEventListener('start',beginControls);controls.addEventListener('end',endControls)
  /** Tinggi bidang pandang pada jarak tertentu — jembatan perspektif ↔ ortografis. */
  function tinggiPandang(jarak:number){return 2*Math.tan(T.MathUtils.degToRad(perspektif.fov/2))*jarak}
  function nisbahLayar(){return Math.max(.0001,Math.max(1,host.clientWidth)/Math.max(1,host.clientHeight))}
  /** Bingkai ortografis disetel dari jarak kamera, supaya ukuran di layar tidak melompat saat proyeksi ditukar. */
  function bingkaiOrto(jarak:number){
    const tinggi=tinggiPandang(jarak)/2, lebar=tinggi*nisbahLayar()
    ortografis.top=tinggi;ortografis.bottom=-tinggi;ortografis.left=-lebar;ortografis.right=lebar;ortografis.zoom=1;ortografis.updateProjectionMatrix()
  }
  function jarakKamera(){return camera.position.distanceTo(controls.target)||1}
  function kirimSumbu(){
    if(!cb.axes)return
    const asal=controls.target.clone().project(camera)
    const arah=(v:T.Vector3):[number,number,number]=>{const ujung=controls.target.clone().add(v).project(camera);return [ujung.x-asal.x,-(ujung.y-asal.y),ujung.z-asal.z]}
    cb.axes({x:arah(new T.Vector3(1,0,0)),y:arah(new T.Vector3(0,1,0)),z:arah(new T.Vector3(0,0,1))})
  }
  function fitDirection(direction:T.Vector3,up=camera.up.clone()){
    const half=T.MathUtils.degToRad(perspektif.fov/2), vertical=Math.tan(half),horizontal=vertical*nisbahLayar()
    direction.normalize();const right=new T.Vector3().crossVectors(up,direction).normalize(),screenUp=new T.Vector3().crossVectors(direction,right).normalize()
    let distance=1
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const corner=new T.Vector3(x*size.x/2,y*size.y/2,z*size.z/2);distance=Math.max(distance,Math.abs(corner.dot(right))/horizontal+corner.dot(direction),Math.abs(corner.dot(screenUp))/vertical+corner.dot(direction))}
    camera.up.copy(up);controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance*1.12)
    camera.lookAt(center);if(proyeksi==='orthographic')bingkaiOrto(distance*1.12);controls.update();changed()
  }
  /* Tukar proyeksi tanpa memindahkan mata: posisi, arah, dan jarak dipertahankan,
     hanya cara menggambarnya yang berubah — persis Numpad 5 di Blender. */
  function gantiProyeksi(kind:Board3DProjection){
    if(kind===proyeksi)return
    const jarak=jarakKamera(), berikut=kind==='orthographic'?ortografis:perspektif
    berikut.position.copy(camera.position);berikut.up.copy(camera.up);berikut.lookAt(controls.target)
    if(kind==='orthographic')bingkaiOrto(jarak); else {perspektif.aspect=nisbahLayar();perspektif.updateProjectionMatrix()}
    camera=berikut;proyeksi=kind;controls.object=camera as unknown as T.PerspectiveCamera
    controls.handleResize();controls.update();cb.projection?.(kind);changed()
  }
  function fit(){fitDirection(camera.position.clone().sub(controls.target).lengthSq() ? camera.position.clone().sub(controls.target) : new T.Vector3(.3,.25,1))}
  function resize(){
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight)
    perspektif.aspect=w/h;perspektif.updateProjectionMatrix()
    if(proyeksi==='orthographic')bingkaiOrto(jarakKamera())
    renderer.setSize(w,h,false);controls.handleResize();invalidate()
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize()
  function clearLines(group:T.Group){for(const o of [...group.children]){group.remove(o);if(o instanceof T.Line||o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose()}}}
  function line(group:T.Group,points:T.Vector3[],color:number,wireId?:string){const o=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color}));if(wireId)o.userData.wire=wireId;group.add(o);return o}
  function freeModel(root:T.Group){const geos=new Set<T.BufferGeometry>(), mats=new Set<T.Material>(),textures=new Set<T.Texture>();root.traverse(o=>{if(o instanceof T.Mesh){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v)}}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
  function load(url:string){if(!models.has(url)){
    const manager=new T.LoadingManager(); manager.setURLModifier(u=>{if(u!==url&&!u.startsWith('blob:')&&!u.startsWith('data:'))throw Error('External GLB resource blocked');return u})
    models.set(url,new Promise(resolve=>new GLTFLoader(manager).load(url,g=>{if(disposed){freeModel(g.scene);resolve(undefined);return}loadedResources.push(g.scene);resolve(g.scene)},undefined,()=>resolve(undefined))))
  }return models.get(url)!}
  function makeUnit(id:string):Unit {
    const c=input!.state.board.components[id], group=new T.Group();group.userData.component=id;scene.add(group)
    const layers=Array.from({length:5},()=>{const g=new T.Group();group.add(g);return g})
    shape(group,0,0,0,3,3,.18,'#344c60')
    const placeholder=shape(layers[0],0,0,.7,2.7,2.7,.9,'#65768c');placeholder.material=new T.MeshStandardMaterial({color:0x65768c,wireframe:true,transparent:true,opacity:.35})
    shape(layers[1],0,0,.5,2.2,2.2,.18,'#272e35')
    shape(layers[2],-.5,0,.7,.22,1.8,.1,'#c88743')
    shape(layers[3],.4,0,.6,.8,1.3,.6,'#b77334')
    shape(layers[4],0,-.7,.4,1.4,.2,.1,'#e3c581')
    const lever=new T.Group();group.add(lever);shape(lever,0,.2,1.35,.23,1.1,.18,'#e9e4d4')
    const rotor=new T.Group();group.add(rotor);rotor.position.set(0,0,1.4)
    const hub=new T.Mesh(cylinder,mat('#8fb8cb'));hub.rotation.x=Math.PI/2;rotor.add(hub)
    shape(rotor,0,0,.08,1.6,.15,.15,'#e9e4d4');shape(rotor,0,0,.08,.15,1.6,.15,'#e9e4d4')
    const indicator=new T.Mesh(sphere,new T.MeshStandardMaterial({color:0x536271,emissive:0x000000}));indicator.position.set(.85,.85,1.3);indicator.scale.setScalar(1.5);group.add(indicator)
    const labels:Unit['labels']=[]
    function label(node:T.Object3D,text:string,pin:boolean,index=0){const el=document.createElement('button');el.type='button';el.textContent=text;el.title=text;el.className='board3d-label';el.setAttribute('aria-label',pin?`Terminal ${id} ${text}`:`Komponen ${id}`);el.onclick=()=>pin?cb.terminal({componentId:id,index}):cb.select(id);host.appendChild(el);labels.push({node,el,pin})}
    const title=new T.Object3D();title.position.set(0,2,.4);group.add(title);label(title,id,false)
    terminalLabels(c).forEach((name,index)=>{const pin=new T.Mesh(sphere,mat('#e9c56a'));pin.position.fromArray(terminalPoint(index,terminalLabels(c).length));pin.userData.terminal={componentId:id,index};group.add(pin);label(pin,name,true,index)})
    const paths=new T.Group();group.add(paths)
    const unit={group,layers,lever,rotor,indicator,labels,paths,pathKey:'',level:0,levelMotion:transition(),leverMotion:transition(),anchors:new Map()} as Unit
    const url=input!.urls[componentAssetId(c)||c.modelId||id]
    if(url)void load(url).then(source=>{if(!source){cb.assetError?.(id);return}if(disposed||units.get(id)!==unit)return;const visual=source.clone(true), holder=new T.Group();holder.add(visual)
      const bounds=new T.Box3().setFromObject(visual), extent=bounds.getSize(new T.Vector3()), mid=bounds.getCenter(new T.Vector3())
      if(bounds.isEmpty())return
      visual.position.sub(mid);const scale=2.8/Math.max(extent.x,extent.y,extent.z,.001);holder.scale.setScalar(scale);holder.position.z=.8;group.add(holder);unit.loaded=holder;holder.updateMatrixWorld(true);
      for(const anchor of componentAsset(c)?.anchors??[]){if(!anchor.node)continue;const node=visual.getObjectByName(anchor.node)||visual.getObjectByName(anchor.node.replace(/[^a-zA-Z0-9_-]/g,'_'));if(node){const point=group.worldToLocal(node.getWorldPosition(new T.Vector3()));unit.anchors.set(anchor.index,point)}}
      host.dataset.assetLoads=String(Number(host.dataset.assetLoads||0)+1);rebuildCables();invalidate()})
    return unit
  }
  function dropUnits(){for(const unit of units.values()){scene.remove(unit.group);clearLines(unit.paths);(unit.indicator.material as T.Material).dispose();((unit.layers[0].children[0] as T.Mesh).material as T.Material).dispose();unit.labels.forEach(l=>l.el.remove())}units.clear();clearLines(wires);flowGroup.clear();markers.clear();cablePaths.clear()}
  function anchor(t:Terminal){const c=input!.state.board.components[t.componentId],unit=units.get(t.componentId);if(!c||!unit)return undefined;unit.group.updateMatrixWorld(true);return unit.group.localToWorld(new T.Vector3(...terminalPoint(t.index,terminalLabels(c).length)))}
  function rebuild(){cachedRoutes=undefined;dropUnits();const cs=Object.values(input!.state.board.components);for(const c of cs){const u=makeUnit(c.id);units.set(c.id,u);const p=panelPlacement(c,input!.view);u.group.position.set(p.x,p.y,0);u.group.rotation.z=p.rotation*Math.PI/180}
    const positions=cs.map(c=>panelPlacement(c,input!.view)),xs=positions.map(p=>p.x),ys=positions.map(p=>p.y)
    const minX=Math.min(0,...xs)-3,maxX=Math.max(0,...xs)+3,minY=Math.min(0,...ys)-3,maxY=Math.max(0,...ys)+3
    center.set((minX+maxX)/2,(minY+maxY)/2,2);size.set(maxX-minX,maxY-minY,6)
    panel.position.set(center.x,center.y,-.3);panel.scale.set(size.x,size.y,.1)
    rebuildCables()
    if(!initialized){
      /* Papan dibuka dalam pandangan isometrik ortografis — kebiasaan perangkat
         CAD, dan satu-satunya sudut yang memperlihatkan panjang, lebar, dan
         tinggi papan sekaligus tanpa distorsi jarak. Pembaca yang pernah
         menggeser kameranya mendapat sudutnya sendiri kembali, termasuk
         proyeksi yang ia pilih. */
      if(saved){
        if(saved.projection)gantiProyeksi(saved.projection)
        fitDirection(new T.Vector3(.3,.25,1))
        camera.position.fromArray(saved.position);camera.up.fromArray(saved.up);controls.target.fromArray(saved.target);camera.lookAt(controls.target)
        if(proyeksi==='orthographic')bingkaiOrto(jarakKamera())
        controls.update()
      } else side('iso')
      initialized=true
    }
    host.dataset.components=String(units.size);host.dataset.wires=String(wires.children.length);dirty=true
  }
  function rebuildCables(){
    clearLines(wires);flowGroup.clear();markers.clear();cablePaths.clear();if(!input)return
    const bodies=[...units.values()].map(u=>({minX:u.group.position.x-1.5,maxX:u.group.position.x+1.5,minY:u.group.position.y-1.5,maxY:u.group.position.y+1.5}))
    const routes=cachedRoutes??=routeCables(input.state.board,t=>{const point=anchor(t),u=units.get(t.componentId);if(!point||!u)return;return {point,direction:new T.Vector3(t.index%2?1:-1,0,0).applyAxisAngle(new T.Vector3(0,0,1),u.group.rotation.z)}},bodies)
    const physical=(t:Terminal)=>{const u=units.get(t.componentId),p=u?.anchors.get(t.index);return u&&p?u.group.localToWorld(p.clone()):undefined}
    for(const [id,route] of routes){
      const points=route.map(p=>p.clone())
      const w=input.state.board.wires[id],a=physical(w.from),b=w.tap?undefined:physical(w.to)
      if(a){const port=points[0];points.unshift(a,new T.Vector3(a.x,a.y,2),new T.Vector3(port.x,port.y,2))}
      if(b){const port=points[points.length-1];points.push(new T.Vector3(port.x,port.y,2),new T.Vector3(b.x,b.y,2),b)}
      const target=w.tap&&cablePaths.get(w.tap.wireId)
      if(target){const old=points[points.length-1];let best=0,distance=Infinity;for(let i=0;i<=256;i++){const d=target.getPointAt(i/256).distanceToSquared(old);if(d<distance){distance=d;best=i/256}}let lo=Math.max(0,best-1/256),hi=Math.min(1,best+1/256);for(let i=0;i<20;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(target.getPointAt(a).distanceToSquared(old)<target.getPointAt(b).distanceToSquared(old))hi=b;else lo=a}const join=target.getPointAt((lo+hi)/2);points[points.length-1]=join;const dot=new T.Mesh(sphere,mat('#e9c56a'));dot.position.copy(join);flowGroup.add(dot)}
      const curve=cableCurve(points);if(!curve.curves.length)continue;cablePaths.set(id,curve)
      const cable=new T.Mesh(new T.TubeGeometry(curve,Math.max(24,points.length*8),.045,6,false),new T.MeshStandardMaterial({color:({R:0xff7266,S:0xffd36b,T:0xb59aff,N:0x68baff,fault:0xff3333,energized:0xff9673,inactive:0x729db9}[signals[id]?.phase??'inactive']),roughness:.55,metalness:.05}));cable.userData.wire=id;wires.add(cable)
      const count=Math.max(1,Math.ceil(curve.getLength()/2)),list:T.Mesh[]=[]
      for(let i=0;i<count;i++){const marker=new T.Mesh(signals[id]?.signal==='ac-trace'?pulseGeometry:flowGeometry,flowMaterial);marker.renderOrder=10;marker.visible=false;flowGroup.add(marker);list.push(marker)}markers.set(id,list)
    }
    host.dataset.geometryRevision=String(Number(host.dataset.geometryRevision||0)+1);host.dataset.wires=String(cablePaths.size);host.dataset.unrouted=String(Object.keys(input.state.board.wires).length-cablePaths.size)
  }
  let visuals:ReturnType<typeof operatingVisuals>={}
  // Title labels carry the reading; aria-label stays the plain component name so the
  // accessible name does not churn every time a measured value moves.
  function refreshReadouts(){for(const [id,u] of units){const title=u.labels.find(l=>!l.pin);if(!title)continue;const reading=visuals[id]?.measured;const text=reading?`${id} · ${reading}`:id;if(title.el.textContent!==text){title.el.textContent=text;title.el.title=text}}}
  function update(next:SceneInput){
    const previous=input;input=next;signals=wirePresentation(next.state)
    const structureChanged=!previous||previous.state.board.components!==next.state.board.components||previous.state.board.wires!==next.state.board.wires||previous.urls!==next.urls||previous.view.placements!==next.view.placements
    if(structureChanged){const s=JSON.stringify([Object.values(next.state.board.components).map(c=>[c.id,c.modelId,c.spec.kind,terminalLabels(c),panelPlacement(c,next.view)]),next.state.board.wires,next.urls]);if(s!==signature){signature=s;rebuild()}}
    for(const child of wires.children){const wire=next.state.board.wires[child.userData.wire];if(child instanceof T.Mesh&&wire){const chosen=!!next.view.selected&&(wire.from.componentId===next.view.selected||wire.to.componentId===next.view.selected);const material=child.material as T.MeshStandardMaterial;material.color.set(chosen?0xffc66b:({R:0xff7266,S:0xffd36b,T:0xb59aff,N:0x68baff,fault:0xff3333,energized:0xff9673,inactive:0x729db9}[signals[wire.id]?.phase??'inactive']));material.emissive.set(chosen?0x35200b:0x000000);}}
    visuals=operatingVisuals(next.state);refreshReadouts();controls.enabled=next.view.mode==='navigate';const ratio=next.view.quality==='low'||next.view.quality==='auto'&&adaptiveLow?1:Math.min(devicePixelRatio||1,next.view.quality==='high'?2:1.5);if(ratio!==pixelRatio){pixelRatio=ratio;renderer.setPixelRatio(ratio)}invalidate()
    host.dataset.ready='true';const operating=JSON.stringify(visuals);if(host.dataset.operating!==operating)host.dataset.operating=operating;host.dataset.renderer='device-webgl2'
  }
  let down:{x:number;y:number;id?:string;plane:T.Vector3}|undefined
  function hit(e:PointerEvent){const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);ray.params.Line={threshold:.15};return ray.intersectObjects([...units.values()].map(u=>u.group).concat(wires),true)}
  function componentOf(o:T.Object3D|undefined):string|undefined{while(o){if(o.userData.component)return o.userData.component;o=o.parent||undefined}}
  function start(e:PointerEvent){if(!input||input.view.mode==='navigate')return;const h=hit(e);const p=ray.ray.intersectPlane(workplane,new T.Vector3());if(p){down={x:e.clientX,y:e.clientY,id:componentOf(h[0]?.object),plane:p};canvas.setPointerCapture(e.pointerId)}}
  function end(e:PointerEvent){const d=down;down=undefined;if(!d||!input)return;const h=hit(e),p=ray.ray.intersectPlane(workplane,new T.Vector3());if(input.view.mode==='move'&&input.editable&&d.id&&p){const old=panelPlacement(input.state.board.components[d.id],input.view);cb.move(d.id,{...old,x:Math.round(old.x+p.x-d.plane.x),y:Math.round(old.y+p.y-d.plane.y)});return}
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>8)return
    const terminal=h.find(v=>v.object.userData.terminal)?.object.userData.terminal as Terminal|undefined
    const wire=h.find(v=>v.object.userData.wire)?.object.userData.wire as string|undefined
    if(input.view.mode==='wire'&&input.editable){if(terminal)cb.terminal(terminal);else if(wire)cb.wire(wire);return}
    if(d.id)cb.select(d.id);else if(p&&input.placing&&input.editable)cb.place(p.x,p.y)
  }
  /* Pintasan angka mengikuti kebiasaan Numpad Blender, supaya orang yang sudah
     terbiasa memodelkan tidak perlu belajar ulang:
     1 depan · 3 kanan · 7 atas (tahan Ctrl untuk sisi seberangnya) ·
     9 memutar ke seberang · 5 menukar proyeksi · 0 pandangan isometrik ·
     F memuat seluruh papan · +/− zoom. */
  const SISI_TOMBOL:Record<string,[string,string]>={'1':['front','back'],'3':['right','left'],'7':['top','bottom']}
  function keyboard(e:KeyboardEvent){
    const k=e.key.toLowerCase()
    if(k==='f'){e.preventDefault();fit();return}
    if(['+','=','-','_'].includes(e.key)){e.preventDefault();zoomKe(e.key==='-'||e.key==='_'?1.15:1/1.15);return}
    if(SISI_TOMBOL[e.key]){e.preventDefault();side(SISI_TOMBOL[e.key][e.ctrlKey||e.metaKey?1:0]);return}
    if(e.key==='9'){e.preventDefault();side('opposite');return}
    if(e.key==='5'){e.preventDefault();gantiProyeksi(proyeksi==='orthographic'?'perspective':'orthographic');return}
    if(e.key==='0'){e.preventDefault();side('iso')}
  }
  function zoomKe(faktor:number){camera.position.sub(controls.target).multiplyScalar(faktor).add(controls.target);if(proyeksi==='orthographic')bingkaiOrto(jarakKamera());controls.update();changed()}
  const ARAH_SISI:Record<string,[number,number,number]>={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0],iso:[1,.8,1]}
  function side(s:string){
    if(s==='opposite'){const balik=controls.target.clone().sub(camera.position);fitDirection(balik.lengthSq()?balik:new T.Vector3(0,0,-1));return}
    /* Isometrik hanya jujur pada kamera ortografis, jadi memilihnya sekaligus
       menukar proyeksi — sama seperti menekan Numpad 5 lalu 0 di Blender. */
    if(s==='iso')gantiProyeksi('orthographic')
    const arah=ARAH_SISI[s]||ARAH_SISI.front
    fitDirection(new T.Vector3(...arah),s==='top'?new T.Vector3(0,0,-1):s==='bottom'?new T.Vector3(0,0,1):new T.Vector3(0,1,0))
  }
  canvas.addEventListener('keydown',keyboard)
  canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointerup',end)
  const cancel=()=>{down=undefined};canvas.addEventListener('pointercancel',cancel)
  function tick(now:number){frame=0;if(disposed||document.hidden||!input){lastTick=undefined;return}
    const fps=input.view.quality==='low'||input.view.quality==='auto'&&adaptiveLow?30:60
    if(now-lastRender<1000/fps){wake();return}
    const dt=lastTick===undefined?0:now-lastTick;lastTick=now
    controls.update();let moving=false
    for(const [id,u] of units){const c=input.state.board.components[id],v=visuals[id],goal=componentStage(c,input.view)
      u.level=sampleTransition(u.levelMotion,goal,now,input.reduced);moving ||= u.level!==goal
      const opened=u.level>.01;u.layers.forEach((g,i)=>{g.position.set(i?Math.max(0,Math.min(1,u.level-i))*(i%2?1:-1)*2:0,0,Math.max(0,Math.min(1,u.level-i))*(2+i*.8));g.visible=i===0?!u.loaded:input!.view.conceptual&&opened&&i<assemblyStages(c).length})
      if(u.loaded){u.loaded.position.z=.8+Math.min(u.level,1)*3;u.loaded.visible=true}
      u.lever.visible=['SWITCH','SWITCH_2WAY','SWITCH_CROSS','PUSHBUTTON','SELECTOR_3POS','ESTOP','BREAKER_1P','BREAKER_3P','LIMIT_SWITCH','CONTACT_2STATE','TERMINAL_BLOCK'].includes(c.spec.kind)||(opened&&input.view.conceptual&&['RELAY','CONTACTOR','OVERLOAD_RELAY'].includes(c.spec.kind))
      if(u.loaded&&!opened)u.lever.visible=false
      u.lever.position.z=opened?Math.min(u.level,2)*1.5:0
      const angle=(v?.actuator??0)*Math.PI/3
      u.lever.rotation.z=sampleTransition(u.leverMotion,angle,now,input.reduced);moving ||= u.lever.rotation.z!==angle
      const motor=['MOTOR','MOTOR_3PH'].includes(c.spec.kind)||(c.spec.kind==='LOAD'&&c.spec.symbol==='fan')
      u.rotor.visible=motor&&!u.loaded;u.rotor.position.x=opened&&input.view.conceptual?Math.min(u.level,4)*.7:0
      if(motor&&v?.rotor&&input.state.status==='RUNNING'&&!input.reduced){u.rotor.rotation.z=rotorStep(u.rotor.rotation.z,dt,true);moving=true}
      const im=u.indicator.material as T.MeshStandardMaterial;im.color.set(v?.trip?'#ff6559':v?.active?'#65ffb0':'#637589');im.emissive.set(v?.active?'#146b40':'#000000')
      u.group.updateMatrixWorld(true)
      const pathKey=JSON.stringify([v?.contacts,v?.branches,input.view.paths,input.view.conceptual]);if(pathKey!==u.pathKey){u.pathKey=pathKey;clearLines(u.paths);if(input.view.paths&&input.view.conceptual&&v){for(const [a,b] of v.contacts)line(u.paths,[new T.Vector3(...terminalPoint(a,terminalLabels(c).length)),new T.Vector3(0,0,1.9),new T.Vector3(...terminalPoint(b,terminalLabels(c).length))],0x54fca2);for(const [a,b] of v.branches)line(u.paths,[new T.Vector3(...terminalPoint(a,terminalLabels(c).length)),new T.Vector3(0,-.8,1.7),new T.Vector3(...terminalPoint(b,terminalLabels(c).length))],0xf1b865)}}
      const origin=u.group.getWorldPosition(new T.Vector3()),projected=origin.clone().project(camera),edge=origin.clone().add(new T.Vector3(3,0,0)).project(camera),pixels=Math.abs(edge.x-projected.x)*host.clientWidth/2
      for(const l of u.labels){const chosen=input.view.selected===id,show=l.pin?chosen||input.view.mode==='wire':chosen||units.size<=12||pixels>75;if(l.el.hidden===show)l.el.hidden=!show;if(show){const p=l.node.getWorldPosition(new T.Vector3()).project(camera);const maxWidth=l.pin?'none':`${Math.max(35,pixels)}px`;if(l.el.style.maxWidth!==maxWidth)l.el.style.maxWidth=maxWidth;const display=Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>-1&&p.z<1?'':'none';if(l.el.style.display!==display)l.el.style.display=display;const transform=`translate(${((p.x+1)/2*host.clientWidth).toFixed(2)}px,${((1-p.y)/2*host.clientHeight).toFixed(2)}px) translate(-50%,-50%)`;if(l.el.style.transform!==transform)l.el.style.transform=transform;const disabled=l.pin&&(!input.editable||input.view.mode!=='wire');if(l.el.disabled!==disabled)l.el.disabled=disabled}}
    }
    let visibleMarkers=0
    for(const [id,list] of markers){const signal=signals[id],curve=cablePaths.get(id)!;const length=curve.getLength();const phase=input.reduced?0:input.state.timeMs/1000*1.2/Math.max(length,.001)
      for(let i=0;i<list.length;i++){const m=list[i];m.visible=!!signal?.flowing;if(!m.visible)continue;visibleMarkers++;let f=(i/list.length+phase)%1;if(signal.direction===-1)f=1-f;m.position.copy(curve.getPointAt(f));const tangent=curve.getTangentAt(f).multiplyScalar(signal.direction===-1?-1:1);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),tangent.normalize())}
    }
    host.dataset.flowing=JSON.stringify(Object.keys(signals).filter(id=>signals[id].flowing));host.dataset.flowMarkers=String(visibleMarkers);host.dataset.flowSample=JSON.stringify([...markers].slice(0,4).map(([id,list])=>[id,list[0]?.position.toArray()]))
    const rotors=JSON.stringify(Object.fromEntries([...units].filter(([,u])=>u.rotor.visible).map(([id,u])=>[id,u.rotor.rotation.z])))
    if(host.dataset.rotors!==rotors)host.dataset.rotors=rotors
    if((dirty||moving)&&now-lastRender>=1000/fps){const began=performance.now();renderer.render(scene,camera);if(performance.now()-began>25&&input.view.quality==='auto'){if(++slowFrames>30){adaptiveLow=true;renderer.setPixelRatio(1)}}lastRender=now;dirty=false;host.dataset.drawCalls=String(renderer.info.render.calls)}
    if(moving||dirty||interacting)wake();else lastTick=undefined
  }
  wake()
  const visibility=()=>{lastTick=undefined;invalidate()};document.addEventListener('visibilitychange',visibility)
  function lost(e:Event){e.preventDefault();persist();cb.error()}
  canvas.addEventListener('webglcontextlost',lost);window.addEventListener('pagehide',persist)
  return {update,fit,focus(id){const u=units.get(id);if(!u)return;const oldCenter=center.clone(),oldSize=size.clone();center.copy(u.group.position).add(new T.Vector3(0,0,2));size.set(6,6,u.level>0?10:5);fit();center.copy(oldCenter);size.copy(oldSize)},zoom(f){zoomKe(f)},side,projection(kind){gantiProyeksi(kind)},dispose(){persist();disposed=true;cancelAnimationFrame(frame);clearTimeout(saveTimer);observer.disconnect();document.removeEventListener('visibilitychange',visibility);controls.removeEventListener('start',beginControls);controls.removeEventListener('end',endControls);controls.dispose();dropUnits();loadedResources.forEach(freeModel);materials.forEach(m=>m.dispose());box.dispose();sphere.dispose();cylinder.dispose();flowGeometry.dispose();pulseGeometry.dispose();flowMaterial.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();window.removeEventListener('pagehide',persist);canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('keydown',keyboard);canvas.removeEventListener('pointerdown',start);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',cancel);delete host.dataset.ready}}
}
