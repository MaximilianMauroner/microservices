/** User-controlled preview typography stored in the current browser. */
export type DisplaySettings = {
  fontScale: number;
  lineSpacing: number;
};

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  fontScale: 1,
  lineSpacing: 1.7,
};

export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.4;
export const FONT_SCALE_STEP = 0.1;
export const LINE_SPACING_MIN = 0.8;
export const LINE_SPACING_MAX = 2.2;
export const LINE_SPACING_STEP = 0.1;

export function parseDisplaySettings(value: string | null): DisplaySettings {
  if (value === null) {
    return DEFAULT_DISPLAY_SETTINGS;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_DISPLAY_SETTINGS;
    }

    return {
      fontScale: normalizeDisplayValue(
        "fontScale" in parsed ? parsed.fontScale : undefined,
        FONT_SCALE_MIN,
        FONT_SCALE_MAX,
        DEFAULT_DISPLAY_SETTINGS.fontScale,
      ),
      lineSpacing: normalizeDisplayValue(
        "lineSpacing" in parsed ? parsed.lineSpacing : undefined,
        LINE_SPACING_MIN,
        LINE_SPACING_MAX,
        DEFAULT_DISPLAY_SETTINGS.lineSpacing,
      ),
    };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

export function normalizeDisplayValue(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100;
}
