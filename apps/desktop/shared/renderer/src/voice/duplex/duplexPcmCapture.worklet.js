class OpenDrSaiDuplexPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const copies = channels.map((channel) => channel.slice());
    this.port.postMessage({ type: "audio", channels: copies }, copies.map((channel) => channel.buffer));
    return true;
  }
}
registerProcessor("opendrsai-duplex-pcm-capture", OpenDrSaiDuplexPcmCaptureProcessor);
