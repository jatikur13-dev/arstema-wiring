/**
 * Public surface of the M0 circuit engine.
 *
 * Public package engine entry. No React/DOM, host storage, feature, or UI imports.
 * The package/host boundary is checked by scripts/checkFeatureBoundaries.mjs.
 */

export * from './types'
export * from './standards'
export * from './evidence'
export * from './coverage'
export * from './semanticNets'
export * from './project'
export * from './roadmap'
export * from './relayModels'
export * from './componentModels'
export * from './timerSettings'
export { buildNodes, buildPhysicalNodes, type NodeMap } from './topology'
export {
  solveBoard,
  solveCircuit,
  solveLinearSystem,
  computeMotorRunning,
  deriveAutomaticProductActuation,
  type Solution,
  type CircuitSolution,
  type MotorStatus,
} from './solve'
export {
  bridgedPairs,
  resistiveBranch,
  resistiveBranches,
  timerPhase,
  multifunctionTimerOutputOn,
  overloadThermalStep,
  mcbClosed,
  mcbProtectionStep,
  TIMER_COIL_OHMS,
  OVERLOAD_SENSE_OHMS,
  MCB_SENSE_OHMS,
  type RelayEnergized,
  type ContactorEnergized,
  type TimerRuntime,
  type OverloadRuntime,
  type McbRuntime,
  type McbTripReason,
  type RuntimeContacts,
} from './conduction'
export {
  solveThreePhase,
  threePhaseSourcePhasors,
  solveComplexSystem,
  detectFixedSourceConflict,
  type ThreePhaseSolution,
  type ThreePhaseSourcePhasors,
  type ThreePhaseFault,
  type ThreePhaseFaultCode,
  type ThreePhaseLineTriple,
  type NodeMeasurement,
  type NodeStatus,
} from './threePhase'
export {
  phasor,
  complex,
  add,
  sub,
  mul,
  div,
  scale,
  conjugate,
  magnitude,
  angleDegrees,
  type Complex,
} from './phasor'
export {
  traceCurrentPath,
  classifyThreePhaseWires,
  isMotor3phRunning,
  type FlowTrace,
  type WireFlow,
  type WirePhase,
  type WirePhaseClass,
} from './flow'
export { classifyWires, wireNodeMap, type WireClass } from './wiring'
export type { FaultCode, FaultRecord } from './fault'
export {
  circuitReducer,
  initialCircuitState,
  buildCircuitRuntimeNodes,
  runtimeContacts,
  type CircuitState,
  type CircuitAction,
  type CircuitStatus,
  type CircuitDisplay,
  type CircuitEvent,
} from './engine'
