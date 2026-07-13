export function cellToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (!value.length) return '';
    return value.map((item) => cellToText(item)).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of ['text', 'name', 'title', 'label', 'option']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  return '';
}

export function cellToNumber(value: unknown): number {
  const n = parseFloat(cellToText(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function truncateText(text: string, max = 40): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
