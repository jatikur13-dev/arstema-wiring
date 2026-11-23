import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createRef} from 'react';
import {WiringApp,type WiringAppProps,type WiringHandle} from './react';
export type {WiringAppProps};
const mounted=new WeakSet<HTMLElement>();
export function createWiringApp(container:HTMLElement,options:WiringAppProps={}){
 if(mounted.has(container)||container.childNodes.length)throw Error('Wiring requires an empty, unmounted container');
 const root=createRoot(container),ref=createRef<WiringHandle>();let active=options.active!==false,destroyed=false;mounted.add(container);
 const render=()=>flushSync(()=>root.render(<WiringApp {...options} active={active} ref={ref}/>));render();
 const check=()=>{if(destroyed)throw Error('Wiring instance has been destroyed');};
 return {getProject(){check();return ref.current!.getProject();},loadProject(value:unknown){check();let accepted=false;flushSync(()=>{accepted=ref.current!.loadProject(value);});return accepted;},setActive(value:boolean){check();active=value;render();},destroy(){if(destroyed)return;destroyed=true;flushSync(()=>root.unmount());mounted.delete(container);}};
}
