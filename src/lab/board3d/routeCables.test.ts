import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { routeCables } from './routeCables'
import { cableCurve } from './cableGeometry'
import type { Board } from '../../engine/types'
const board:Board={components:{},wires:{w:{id:'w',from:{componentId:'a',index:0},to:{componentId:'b',index:0}},parallel:{id:'parallel',from:{componentId:'a',index:1},to:{componentId:'b',index:1}}}}
const anchor=(t:{componentId:string;index:number})=>({point:new Vector3(t.componentId==='a'?-5:5,t.index*.4,.35),direction:new Vector3(t.componentId==='a'?1:-1,0,0)})
it('preserves exact endpoints, separates parallel wires and avoids a component body',()=>{
  const routes=routeCables(board,anchor,[{minX:-1,maxX:1,minY:-2,maxY:2}])
  expect(routes.size).toBe(2)
  for(const [id,points] of routes){
    expect(points[0]).toEqual(anchor(board.wires[id].from).point)
    expect(points[points.length-1]).toEqual(anchor(board.wires[id].to).point)
    const curve=cableCurve(points)
    for(let i=0;i<=300;i++){const p=curve.getPointAt(i/300);expect(p.z>2.5||Math.abs(p.x)>=1||Math.abs(p.y)>=2).toBe(true)}
  }
  expect(routes.get('w')).not.toEqual(routes.get('parallel'))
  expect(routeCables(board,anchor,[{minX:-1,maxX:1,minY:-2,maxY:2}])).toEqual(routes)
})
