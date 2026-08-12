// Color constants for reports and charts
export const C_NAVY = "#0F172A";
export const C_WHITE = "#FFFFFF";
export const C_GREY_LIGHT = "#F5F5F5";
export const C_GREY = "#808080";
export const C_BLUE_LIGHT = "#E3F2FD";
export const C_GREEN = "#4CAF50";
export const C_AMBER = "#FFC107";
export const C_RED = "#F44336";

// Convert hex color to RGB array [r, g, b]
export function toRgb(hex: string): [number, number, number] {
  // Remove # if present
  const cleanHex = hex.replace("#", "");
  
  // Convert hex to RGB
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  
  return [r, g, b];
}

// Format number with dashes (e.g., 1000 -> 1-000), handles undefined/null/empty
export function dash(value: string | number | null | undefined): string {
  // Handle null or undefined
  if (value === null || value === undefined) {
    return "N/A";
  }
  
  // Convert to string if number
  const strValue = String(value);
  
  // Return as-is if empty or non-numeric  
  if (!strValue) return "N/A";
  if (isNaN(Number(strValue))) return strValue;
  
  // Add dashes for large numbers
  return strValue.replace(/\B(?=(\d{3})+(?!\d))/g, "-");
}
