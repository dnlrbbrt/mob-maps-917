// Dark mob-themed color palette
export const colors = {
  // Background colors
  background: '#121212',        // Main dark background
  surface: '#1E1E1E',          // Cards, modals, elevated surfaces
  surfaceVariant: '#2A2A2A',   // Secondary surfaces, input backgrounds
  
  // Text colors
  text: '#FFFFFF',             // Primary text on dark
  textSecondary: '#B0B0B0',    // Secondary text, subtitles
  textTertiary: '#808080',     // Disabled, placeholder text
  
  // Primary accent (orange-red)
  primary: '#FF4500',          // Main brand color (orange-red)
  primaryDark: '#E63E00',      // Darker primary for pressed states
  primaryLight: '#FF6B33',     // Lighter primary for highlights
  
  // Secondary accent
  secondary: '#FF8C00',        // Darker orange for secondary actions
  secondaryDark: '#E67E00',    // Darker secondary
  
  // Status colors
  success: '#4CAF50',          // Green for success states
  warning: '#FF9800',          // Orange for warnings
  error: '#F44336',            // Red for errors
  info: '#2196F3',             // Blue for info
  
  // Borders and dividers
  border: '#404040',           // Default borders
  borderLight: '#303030',      // Subtle borders
  divider: '#353535',          // Dividers between sections
  
  // Interactive elements
  button: '#FF4500',           // Primary buttons
  buttonSecondary: '#2A2A2A',  // Secondary buttons
  buttonDisabled: '#404040',   // Disabled buttons
  
  // Specific UI elements
  tabBar: '#1A1A1A',          // Bottom tab bar
  tabBarActive: '#FF4500',     // Active tab
  tabBarInactive: '#808080',   // Inactive tab
  
  input: '#2A2A2A',           // Input backgrounds
  inputBorder: '#404040',      // Input borders
  inputFocus: '#FF4500',       // Focused input borders
  
  card: '#1E1E1E',            // Card backgrounds
  cardBorder: '#303030',       // Card borders
  
  // Map specific
  mapText: '#FFFFFF',          // Text on map overlays
  mapBackground: 'rgba(18, 18, 18, 0.8)', // Semi-transparent overlays
  
  // Special states
  highlight: '#FF4500',        // Highlight color
  overlay: 'rgba(0, 0, 0, 0.7)', // Modal overlays
  
  // Rankings/leaderboard
  gold: '#FFD700',            // First place
  silver: '#C0C0C0',          // Second place
  bronze: '#CD7F32',          // Third place
};

// Helper function to get color with opacity
export const withOpacity = (color: string, opacity: number): string => {
  // Simple hex to rgba conversion for basic colors
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
};



