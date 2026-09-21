export interface LatestOperationTicket<T> {
  promise: Promise<T>;
  isCurrent: () => boolean;
  release: () => boolean;
}

/** Coordinates replaceable async work without allowing stale cleanup to affect newer work. */
export class LatestOperationGate<T> {
  private generation = 0;
  private active: Promise<T> | null = null;

  get current(): Promise<T> | null {
    return this.active;
  }

  invalidate(): void {
    this.generation += 1;
    this.active = null;
  }

  start(factory: (isCurrent: () => boolean) => Promise<T>): LatestOperationTicket<T> {
    if (this.active) {
      throw new Error("LatestOperationGate already has an active operation.");
    }

    const generation = this.generation + 1;
    this.generation = generation;
    let promise!: Promise<T>;
    const isCurrent = (): boolean => this.generation === generation && this.active === promise;
    promise = Promise.resolve().then(() => factory(isCurrent));
    this.active = promise;

    return {
      promise,
      isCurrent,
      release: (): boolean => {
        if (!isCurrent()) return false;
        this.active = null;
        return true;
      },
    };
  }
}
