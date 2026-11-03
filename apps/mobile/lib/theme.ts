/**
 * Design tokens from the chosen command-center mockup (mockups/home-radar.html).
 * Dark console UI: amber for interactive elements, semantic colors for stock state.
 */
export const colors = {
  bg: '#070b10',
  field: '#0b1118',
  panel: '#101923',
  panel2: '#142030',
  line: '#1e2b3a',
  ink: '#dbe5ee',
  muted: '#7f92a5',
  accent: '#ffb547',
  accentInk: '#1a1004',
  live: '#34d399',
  watch: '#5cc8ff',
  dead: '#ff6470',
  warn: '#ff9248',
} as const;

export const fonts = {
  display: 'ChakraPetch_700Bold',
  displaySemi: 'ChakraPetch_600SemiBold',
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemi: 'IBMPlexSans_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoSemi: 'IBMPlexMono_600SemiBold',
} as const;

export const radius = { sm: 6, md: 10, lg: 12, xl: 16 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
