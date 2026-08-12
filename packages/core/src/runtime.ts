/** Time enters domain behavior through this port so tests never depend on the wall clock. */
export interface Clock {
  now(): Date;
}

/** New identifiers enter domain behavior through this port so tests stay deterministic. */
export interface IdGenerator {
  nextId(): string;
}
