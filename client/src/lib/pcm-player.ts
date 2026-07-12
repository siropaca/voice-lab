/**
 * 生 PCM（signed 16-bit LE mono）チャンクを Web Audio API で再生するプレイヤー。
 * MSE は mp3 用（`MsePlayer`）だが、Google Chirp 3 HD の streaming 合成は PCM しか
 * 返さないため、こちらで再生する。インターフェースは MsePlayer と揃える
 * （audioEl はイベント発火用のダミー要素。実再生は AudioContext が担う）。
 *
 * このラボの UX では再生は合成完了後（done）に押されるため、チャンクを貯めて
 * play() 時に 1 本の AudioBuffer にまとめて鳴らす。
 */
export class PcmPlayer {
  readonly audioEl: HTMLAudioElement;
  private readonly sampleRate: number;
  private chunks: Float32Array[] = [];
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    // 再生状態イベント（play / pause / ended）の発火先。DOM 上では無音。
    this.audioEl = document.createElement('audio');
  }

  /** base64 の PCM16(LE) チャンクを Float32（-1..1）へ変換して貯める。 */
  appendChunk(b64: string) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const n = bytes.length >> 1;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 0x8000;
    this.chunks.push(f);
  }

  /** これ以上チャンクが来ないことを通知する（PCM では貯めるだけなので何もしない）。 */
  endOfStream() {}

  /** 貯めた PCM をまとめて再生する。 */
  async play() {
    this.stop();
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    if (total === 0) return;

    const ctx = new AudioContext();
    this.ctx = ctx;
    const buffer = ctx.createBuffer(1, total, this.sampleRate);
    const channel = buffer.getChannelData(0);
    let offset = 0;
    for (const c of this.chunks) {
      channel.set(c, offset);
      offset += c.length;
    }
    const source = ctx.createBufferSource();
    this.source = source;
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      this.audioEl.dispatchEvent(new Event('pause'));
      this.audioEl.dispatchEvent(new Event('ended'));
    };
    if (ctx.state === 'suspended') await ctx.resume();
    source.start();
    this.audioEl.dispatchEvent(new Event('play'));
  }

  private stop() {
    try {
      this.source?.stop();
    } catch {
      /* not started */
    }
    this.source = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
