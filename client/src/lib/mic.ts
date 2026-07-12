import { downsample, floatTo16BitPcm } from './pcm';

const WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
`;

export interface MicCapture {
  stop(): void;
}

/**
 * マイクを取得し、AudioWorklet 経由で Float32 フレームを受け取り
 * 16kHz 16bit PCM に変換して onChunk へ渡す。onLevel には各フレームの RMS（0..1）を渡す。
 */
export async function startMic(
  onChunk: (pcm: Int16Array) => void,
  onLevel?: (level: number) => void,
): Promise<MicCapture> {
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(
    URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })),
  );
  const source = ctx.createMediaStreamSource(media);
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data;
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      onLevel(Math.sqrt(sum / (frame.length || 1)));
    }
    onChunk(floatTo16BitPcm(downsample(frame, ctx.sampleRate, 16000)));
  };
  source.connect(node);
  return {
    stop() {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      media.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
