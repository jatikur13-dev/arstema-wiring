import {useEffect,useRef} from 'react';
import {useWiringServices} from './services';
export function useBack(priority:number,handler:()=>boolean){const {back,active}=useWiringServices(),ref=useRef(handler);ref.current=handler;useEffect(()=>back.register(priority,()=>active&&ref.current()),[back,priority,active]);}
export function useBackActions(){const {back}=useWiringServices();return {captureBackEditor:back.captureEditor,dispatchBack:back.dispatch};}
