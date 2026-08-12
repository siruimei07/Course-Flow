import type { Clock, IdGenerator } from "@courseflow/core";

export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: string | Date) {
    this.#instant = new Date(instant);
    if (Number.isNaN(this.#instant.valueOf())) {
      throw new TypeError("FixedClock requires a valid instant.");
    }
  }

  now(): Date {
    return new Date(this.#instant);
  }
}

export class SequenceIdGenerator implements IdGenerator {
  #index = 0;

  constructor(private readonly ids: readonly string[]) {
    if (ids.length === 0 || ids.some((id) => id.length === 0)) {
      throw new TypeError("SequenceIdGenerator requires at least one non-empty ID.");
    }
  }

  nextId(): string {
    const id = this.ids[this.#index];
    if (id === undefined) {
      throw new Error("SequenceIdGenerator is exhausted.");
    }
    this.#index += 1;
    return id;
  }
}

export { MemoryCourseFlowRepository } from "./memory-repositories";
