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
  /** 実際にキャプチャしているデバイス名（トラックのラベル） */
  deviceLabel: string;
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

/**
 * getUserMedia に渡す音声制約を組み立てる。
 * Chrome は deviceId 未指定だと OS の既定デバイスではなく独自の優先順位
 * （内蔵マイクなど）で選ぶため、未指定時は OS 既定に追従する仮想デバイス
 * 'default' を ideal 指定する（'default' が無いブラウザでは単に無視される）。
 */
export function micAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    deviceId: deviceId ? { exact: deviceId } : { ideal: 'default' },
  };
}

/**
 * 利用可能なマイク（audioinput）の一覧を返す。
 * ラベルはマイク権限の付与前は空になり得るため、その場合は連番で補う。
 */
export async function listMics(): Promise<MicDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `マイク ${i + 1}` }));
}

/**
 * マイクを取得し、AudioWorklet 経由で Float32 フレームを受け取り
 * 16kHz 16bit PCM に変換して onChunk へ渡す。onLevel には各フレームの RMS（0..1）を渡す。
 * deviceId を指定するとそのマイクを使う（未指定は OS 既定に追従）。
 */
export async function startMic(
  onChunk: (pcm: Int16Array) => void,
  onLevel?: (level: number) => void,
  deviceId?: string,
): Promise<MicCapture> {
  const media = await navigator.mediaDevices.getUserMedia({
    audio: micAudioConstraints(deviceId),
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
  // AudioWorklet の process() は、出力がグラフ上で destination まで到達していないと
  // 呼ばれない。CaptureProcessor は出力に何も書かない（＝無音）ので、destination に
  // 繋いでも音は鳴らない。これが無いとフレームが一切流れずメーター/送信が動かない。
  node.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume();
  return {
    deviceLabel: media.getAudioTracks()[0]?.label ?? '',
    stop() {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      media.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
