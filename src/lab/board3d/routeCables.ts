import { Vector3 } from 'three'
import type { Board, Terminal } from '../../engine/types'
import { terminalKey } from '../../engine/types'
import { routeBoardWires, computeCrossings, hopsOnSegment, type Rect, type WireRouteRequest } from '../board/geometry'
import { cableCurve } from './cableGeometry'

const SCALE = 60
export interface Anchor { point: Vector3; direction: Vector3 }
/** The same reserved-corridor topology as IEC/Visual, expressed in panel units. */
export function routeCables(board: Board, anchor: (t: Terminal) => Anchor | undefined, bodies: Rect[]): Map<string, Vector3[]> {
  const requests: WireRouteRequest[] = [], endpoints = new Map<string, [Vector3, Vector3]>()
  const scaledBodies = bodies.map(r => ({ minX: r.minX*SCALE, maxX: r.maxX*SCALE, minY: r.minY*SCALE, maxY: r.maxY*SCALE }))
  for (const w of Object.values(board.wires)) {
    const a=anchor(w.from),b=anchor(w.to); if(!a||!b)continue
    const endpoint=(t:Terminal,v:Anchor)=>({point:{x:v.point.x*SCALE,y:v.point.y*SCALE},direction:{x:v.direction.x,y:v.direction.y},terminalKey:terminalKey(t)})
    requests.push({id:w.id,from:endpoint(w.from,a),to:endpoint(w.to,b),priority:w.tap?1:0})
    endpoints.set(w.id,[a.point,b.point])
  }
  let routed=routeBoardWires(requests,scaledBodies)
  // Tap coordinates belong to their target's rendered path, never a guessed elbow.
  for (let pass=0;pass<requests.length;pass++) {
    let changed=false
    for (const request of requests) {
      const tap=board.wires[request.id].tap;if(!tap||request.join)continue
      const target=routed.find(r=>r.id===tap.wireId);if(!target)continue
      const curve=cableCurve(target.points.map(p=>new Vector3(p.x/SCALE,p.y/SCALE,.35)))
      if(!curve.curves.length)continue
      const p=curve.getPointAt(Math.max(0,Math.min(1,tap.panel3dPosition??.5)))
      const point={x:p.x*SCALE,y:p.y*SCALE}
      request.to={point,direction:{x:0,y:1},terminalKey:request.to.terminalKey};request.join={wireId:tap.wireId,point}
      endpoints.get(request.id)![1]=p;changed=true
    }
    if(!changed)break
    routed=routeBoardWires(requests,scaledBodies)
  }
  const geometries=routed.map(r=>({...r,node:''})),{hops}=computeCrossings(geometries)
  const result=new Map<string,Vector3[]>()
  for(const route of routed){
    const [a,b]=endpoints.get(route.id)!,points:Vector3[]=[a.clone()]
    for(let i=0;i<route.points.length;i++){
      const p=route.points[i];points.push(new Vector3(p.x/SCALE,p.y/SCALE,.35))
      const next=route.points[i+1];if(!next)continue
      for(const crossing of hopsOnSegment(p,next,hops[route.id]??[])){
        const sign=Math.sign(next.x-p.x),x=crossing.x/SCALE,y=crossing.y/SCALE
        points.push(new Vector3(x-sign*.18,y,.35),new Vector3(x,y,.65),new Vector3(x+sign*.18,y,.35))
      }
    }
    points.push(b.clone());result.set(route.id,points)
  }
  // A crowded 2D corridor may be exhausted. The 3D board has an additional
  // insulated depth channel above the normalized bodies, with separate lanes.
  // Never discard an electrically valid wire just because its plane is crowded.
  let lane=0
  for(const request of requests){
    if(result.has(request.id))continue
    const [a,b]=endpoints.get(request.id)!,z=3+(lane++)*.18
    const from=request.from.direction,to=request.to.direction
    const exitA=new Vector3(a.x+from.x*.5,a.y+from.y*.5,z)
    const exitB=new Vector3(b.x+to.x*.5,b.y+to.y*.5,z)
    result.set(request.id,[a.clone(),new Vector3(a.x,a.y,z),exitA,new Vector3(exitB.x,exitA.y,z),exitB,new Vector3(b.x,b.y,z),b.clone()])
  }
  return result
}
