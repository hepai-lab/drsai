import type { DesktopThreadSnapshotEnvelope, DesktopThreadSnapshotPatchEvent } from "../../api/desktopApi";

export interface ThreadSnapshotWaterline {
  generation: number;
  appliedSequence: number;
  acceptedSequence: number;
  consecutiveResyncFailures: number;
  actionRequired: boolean;
}

/**
 * Why a Snapshot envelope cannot advance this Thread's waterline.
 *
 * ``generation_regressed`` means Hydration answered with an older projection
 * (typically a persisted one, which has no Runtime waterline at all);
 * ``sequence_regressed`` means the envelope is on the current generation but
 * behind the boundary already displayed.  Both used to be silent, which is why
 * a permanently stalled Patch stream produced no diagnostic at all.
 */
export type ThreadSnapshotEnvelopeRejection = "generation_regressed" | "sequence_regressed";

/** Whether an envelope carries a Runtime waterline a Patch stream can continue from. */
export function envelopeHasRuntimeWaterline(envelope: Pick<DesktopThreadSnapshotEnvelope, "generation" | "sessionSequence">): boolean {
  return envelope.generation > 0 || envelope.sessionSequence > 0;
}

const MAX_RESYNC_FAILURES = 3;

/** Owns the atomic Snapshot/Patch waterline; it never owns message content. */
export class ThreadSnapshotCoordinator {
  private readonly states = new Map<string, ThreadSnapshotWaterline>();

  get(threadId: string): ThreadSnapshotWaterline | undefined {
    const state = this.states.get(threadId);
    return state ? { ...state } : undefined;
  }

  acceptEnvelope(envelope: DesktopThreadSnapshotEnvelope): boolean {
    return this.commitEnvelope(envelope, () => undefined);
  }

  /** The rejection ``commitEnvelope`` would report, without mutating anything. */
  rejectionOf(envelope: DesktopThreadSnapshotEnvelope): ThreadSnapshotEnvelopeRejection | null {
    const current = this.states.get(envelope.threadId);
    if (!current) return null;
    if (envelope.generation < current.generation) return "generation_regressed";
    if (envelope.generation === current.generation && envelope.sessionSequence < current.appliedSequence) {
      return "sequence_regressed";
    }
    return null;
  }

  commitEnvelope(envelope: DesktopThreadSnapshotEnvelope, applySnapshot: () => void): boolean {
    const current = this.states.get(envelope.threadId);
    if (this.rejectionOf(envelope)) return false;
    const next = {
      generation: envelope.generation,
      appliedSequence: envelope.sessionSequence,
      acceptedSequence: envelope.sessionSequence,
      consecutiveResyncFailures: 0,
      actionRequired: false,
    };
    this.states.set(envelope.threadId, next);
    try {
      applySnapshot();
    } catch (error) {
      if (current) this.states.set(envelope.threadId, current);
      else this.states.delete(envelope.threadId);
      throw error;
    }
    return true;
  }

  acceptPatch(event: DesktopThreadSnapshotPatchEvent): boolean {
    const current = this.states.get(event.threadId);
    if (!current || current.generation !== event.generation || current.acceptedSequence !== event.baseSequence) return false;
    this.states.set(event.threadId, { ...current, acceptedSequence: event.sessionSequence });
    return true;
  }

  markApplied(threadId: string, sequence: number): void {
    const current = this.states.get(threadId);
    if (!current || sequence < current.appliedSequence || sequence > current.acceptedSequence) return;
    this.states.set(threadId, { ...current, appliedSequence: sequence });
  }

  rejectPending(threadId: string): void {
    const current = this.states.get(threadId);
    if (current) this.states.set(threadId, { ...current, acceptedSequence: current.appliedSequence });
  }

  noteResyncFailure(threadId: string): ThreadSnapshotWaterline {
    const current = this.states.get(threadId) ?? {
      generation: 0, appliedSequence: 0, acceptedSequence: 0,
      consecutiveResyncFailures: 0, actionRequired: false,
    };
    const failures = current.consecutiveResyncFailures + 1;
    const next = { ...current, consecutiveResyncFailures: failures, actionRequired: failures >= MAX_RESYNC_FAILURES };
    this.states.set(threadId, next);
    return { ...next };
  }

  canResync(threadId: string): boolean {
    return !this.states.get(threadId)?.actionRequired;
  }
}
