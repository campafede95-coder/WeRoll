export const PICKER_HEIGHT = 216;
export const PICKER_OPTION_HEIGHT = 43;
export const PICKER_OPTION_GAP = 6;
export const PICKER_COLUMN_PADDING = 76;

export function pickerOffsetForIndex(index: number) {
  return Math.max(
    0,
    PICKER_COLUMN_PADDING +
      index * (PICKER_OPTION_HEIGHT + PICKER_OPTION_GAP) -
      (PICKER_HEIGHT - PICKER_OPTION_HEIGHT) / 2,
  );
}