import type { DesktopThreadSnapshotEnvelope, DesktopThreadSnapshotPatchEvent } from "../../api/desktopApi";

export interface ThreadSnapshotWaterline {
  generation: number;
  appliedSequence: number;
  acceptedSequence: number;
  consecutiveResyncFailures: number;
  actionRequired: boolean;
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

  commitEnvelope(envelope: DesktopThreadSnapshotEnvelope, applySnapshot: () => void): boolean {
    const current = this.states.get(envelope.threadId);
    if (current && (envelope.generation < current.generation
      || (envelope.generation === current.generation && envelope.sessionSequence < current.appliedSequence))) return false;
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
