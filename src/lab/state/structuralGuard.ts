import type { CircuitAction } from '../../engine/engine';
/** One edit gate for every projection and keyboard/toolbar path. Operations stay live. */
export function structuralAction(action: CircuitAction): boolean {
  return ['PLACE_COMPONENT','MOVE_COMPONENT','MOVE_COMPONENT_3D','REMOVE_COMPONENT','CONNECT','DISCONNECT','REPLACE_COMPONENT','SET_MCB_RATING','SET_TIMER_TIMING','SET_TIMER_MODE','UNDO','REDO'].includes(action.type);
}
