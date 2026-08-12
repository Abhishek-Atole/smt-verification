/**
 * SMT production stage sequence.
 * SPI → Feeder → Reflow → AOI → Other
 *
 * This is the canonical order used for:
 *   - Database ORDER BY
 *   - UI grouping and display
 *   - Export section ordering
 *
 * To change the sequence, edit ONLY this file.
 */

export const STAGE_ORDER: Record<string, number> = {
  SPI:    1,
  Feeder: 2,
  Reflow: 3,
  AOI:    4,
  Other:  5,
};

/** Ordered list of stage names — use for dropdowns and iteration */
export const STAGE_SEQUENCE: string[] = Object.entries(STAGE_ORDER)
  .sort((a, b) => a[1] - b[1])
  .map(([name]) => name);
// Result: ['SPI', 'Feeder', 'Reflow', 'AOI', 'Other']

/** Returns stage_order integer for a given stage name. Defaults to 5. */
export function getStageOrder(stage: string): number {
  return STAGE_ORDER[stage] ?? 5;
}
