import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three';

/** Rounded display route. Endpoints remain exact; not a bend-radius specification. */
export function cableCurve(points:readonly Vector3[],radius=.18):CurvePath<Vector3>{
 const vertices=points.filter((p,i)=>i===0||p.distanceToSquared(points[i-1])>1e-12);
 const path=new CurvePath<Vector3>();
 if(vertices.length<2)return path;
 let cursor=vertices[0].clone();
 for(let i=1;i<vertices.length-1;i++){
  const previous=vertices[i-1],corner=vertices[i],next=vertices[i+1];
  const r=Math.max(0,Math.min(radius,previous.distanceTo(corner)*.4,next.distanceTo(corner)*.4));
  const before=corner.clone().add(previous.clone().sub(corner).normalize().multiplyScalar(r));
  const after=corner.clone().add(next.clone().sub(corner).normalize().multiplyScalar(r));
  if(cursor.distanceToSquared(before)>1e-12)path.add(new LineCurve3(cursor,before));
  path.add(new QuadraticBezierCurve3(before,corner.clone(),after));cursor=after;
 }
 const end=vertices[vertices.length-1];
 if(cursor.distanceToSquared(end)>1e-12)path.add(new LineCurve3(cursor,end.clone()));
 return path;
}
