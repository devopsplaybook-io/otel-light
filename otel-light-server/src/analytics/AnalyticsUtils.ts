export function AnalyticsUtilsGetDefaultFromTime(): number {
  return (Date.now() - 10 * 60 * 1000) * 1_000_000;
}

export const AnalyticsUtilsResultLimit = 10000;
