export const parseDate = (value?: string | null) =>
  value ? new Date(value) : null;

export const parseStringArray = (value?: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch {
    // fall through to CSV parsing
  }
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
};

export const toNumericString = (value: unknown) =>
  value === undefined || value === null ? null : String(value);
