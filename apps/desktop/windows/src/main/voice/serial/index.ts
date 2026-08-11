import { configureSystemVoiceSynthesizer } from "../../../../../shared/main/voiceTts";
import { synthesizeWithWindowsSpeech } from "../../systemVoiceTts";

configureSystemVoiceSynthesizer(synthesizeWithWindowsSpeech);

export * from "../../../../../shared/main/voice/serial";
