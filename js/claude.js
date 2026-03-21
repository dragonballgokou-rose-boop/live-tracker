// ============================================
// Claude API Utilities
// ============================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * data:image/jpeg;base64,... 形式のデータURLを
 * Claude API の image source ブロックに変換する。
 *
 * media_type を省略すると Claude API が
 * "media_type: Field required" エラーを返すため、
 * データURLのプレフィックスから必ず抽出して設定する。
 *
 * @param {string} dataUrl - canvas.toDataURL() 等が返すデータURL
 * @returns {{ type: "image", source: { type: "base64", media_type: string, data: string } }}
 */
export function dataUrlToClaudeImageBlock(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL: expected data:<media_type>;base64,<data>');
  }
  const media_type = match[1]; // e.g. "image/jpeg", "image/png", "image/webp"
  const data       = match[2]; // base64 encoded bytes (without prefix)

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type, // ← Field required by Claude API
      data,
    },
  };
}

/**
 * 画像データURLとプロンプトを受け取り、Claude API に送信して結果テキストを返す。
 *
 * @param {string} dataUrl  - データURL (data:image/...;base64,...)
 * @param {string} prompt   - 画像に対する質問・指示
 * @param {string} [apiKey] - Anthropic API キー (省略時は環境変数から取得)
 * @returns {Promise<string>} Claude の応答テキスト
 */
export async function analyzeImageWithClaude(dataUrl, prompt, apiKey) {
  const key = apiKey || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ANTHROPIC_API_KEY);
  if (!key) {
    throw new Error('Anthropic API key is not set. Set VITE_ANTHROPIC_API_KEY in .env');
  }

  const imageBlock = dataUrlToClaudeImageBlock(dataUrl);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          key,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API error ${response.status}: ${err?.error?.message ?? response.statusText}`);
  }

  const result = await response.json();
  const textBlock = result.content?.find(b => b.type === 'text');
  return textBlock?.text ?? '';
}
