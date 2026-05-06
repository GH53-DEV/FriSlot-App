/**
 * Normalize Supabase / network errors for UI (PostgrestError extends Error and adds code/details/hint).
 */
export function formatErrorMessage(err: unknown): string {
  if (err == null) {
    return '發生錯誤（無詳細資訊）';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    const parts: string[] = [];
    const msg = err.message?.trim();
    if (msg) {
      parts.push(msg);
    } else {
      parts.push(err.name || 'Error');
    }
    const any = err as { code?: string; details?: string; hint?: string };
    if (typeof any.code === 'string' && any.code) {
      parts.push(`代碼：${any.code}`);
    }
    if (typeof any.details === 'string' && any.details.trim()) {
      parts.push(any.details.trim());
    }
    if (typeof any.hint === 'string' && any.hint.trim()) {
      parts.push(`提示：${any.hint.trim()}`);
    }
    return parts.join('\n');
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) {
      return m.trim();
    }
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
