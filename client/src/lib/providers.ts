/**
 * 各プロバイダーに固有のチャンネル色を割り当てる。
 * 比較対象そのものを色で符号化する（ミキサーのチャンネルストリップ隠喩）。
 */
export const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10B981', // emerald
  deepgram: '#22D3EE', // cyan
  elevenlabs: '#A78BFA', // violet
  google: '#FBBF24', // amber
  aivis: '#FB7185', // rose
};

/** provider 名からチャンネル色を返す。未知なら中間グレー。 */
export function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? '#8A93A3';
}
