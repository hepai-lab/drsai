/** Public Main-process API for the serial voice route. */
export {
  cancelVoiceTranscription,
  cancelVoiceTranscriptionsForSender,
  cleanupExpiredVoiceTempFiles,
  getVoiceRuntimeStatus,
  startVoiceTranscription,
  writeVoiceTranscriptHandoff,
} from "../../voice";
export {
  cancelVoiceSynthesis,
  cancelVoiceSynthesisForSender,
  getVoiceSynthesisRuntimeStatus,
  startVoiceSynthesis,
} from "../../voiceTts";
