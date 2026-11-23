import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {cableCurve} from './cableGeometry';
describe('display cables',()=>{
 it('keeps endpoints and does not overshoot a right angle',()=>{
  const points=[new Vector3(0,0,0),new Vector3(3,0,0),new Vector3(3,2,0)];
  const c=cableCurve(points);
  expect(c.getPoint(0).toArray()).toEqual([0,0,0]);expect(c.getPoint(1).toArray()).toEqual([3,2,0]);
  for(const p of c.getPoints(100)){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(3);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y).toBeLessThanOrEqual(2);}
  expect(points[1].toArray()).toEqual([3,0,0]);
 });
 it('handles coincident points and very short bends without NaN',()=>{
  const c=cableCurve([new Vector3(),new Vector3(),new Vector3(.001,0,0),new Vector3(.001,.001,0)]);
  expect(c.getPoints(10).every(p=>p.toArray().every(Number.isFinite))).toBe(true);
  expect(cableCurve([new Vector3(),new Vector3()]).curves).toHaveLength(0);
 });
});
