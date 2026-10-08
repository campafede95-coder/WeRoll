/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#17332d',
    tint: '#e36a45',

    // Core surfaces
    background: '#f8f3ea',
    foreground: '#17332d',

    // Cards / elevated surfaces
    card: '#fffaf2',
    cardForeground: '#17332d',

    // Primary action color (buttons, links, active states)
    primary: '#e36a45',
    primaryForeground: '#fffaf2',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e8efe8',
    secondaryForeground: '#234940',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#efe8dc',
    mutedForeground: '#6f7e76',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f4c96b',
    accentForeground: '#17332d',

    // Destructive actions (delete, error states)
    destructive: '#c94e48',
    destructiveForeground: '#fffaf2',

    // Borders and input outlines
    border: '#ded7cb',
    input: '#d7cec0',
  },
  dark: {
    text: '#f8f3ea',
    tint: '#f28a62',
    background: '#152a27',
    foreground: '#f8f3ea',
    card: '#203b35',
    cardForeground: '#f8f3ea',
    primary: '#f28a62',
    primaryForeground: '#152a27',
    secondary: '#284840',
    secondaryForeground: '#f8f3ea',
    muted: '#234139',
    mutedForeground: '#b9c5bb',
    accent: '#f4c96b',
    accentForeground: '#152a27',
    destructive: '#ed766d',
    destructiveForeground: '#152a27',
    border: '#36564d',
    input: '#42645a',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
