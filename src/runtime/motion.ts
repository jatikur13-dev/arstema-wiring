export interface Transition {from:number;target:number;start:number;value:number}
export const transition=(value=0):Transition=>({from:value,target:value,start:0,value});
export function sampleTransition(t:Transition,target:number,now:number,reduced=false){if(target!==t.target){t.from=t.value;t.target=target;t.start=now;}const p=reduced?1:Math.max(0,Math.min(1,(now-t.start)/300));return t.value=t.from+(t.target-t.from)*p*p*(3-2*p);}
export function rotorStep(phase:number,elapsedMs:number,running:boolean){return running?(phase+Math.max(0,Math.min(100,elapsedMs))*.002)%(2*Math.PI):phase;}
