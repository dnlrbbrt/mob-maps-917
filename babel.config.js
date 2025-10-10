module.exports = function(api) {
  api.cache(true);
  
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Remove console logs in production, but keep console.error and console.warn
      process.env.NODE_ENV === 'production' 
        ? ['transform-remove-console', { exclude: ['error', 'warn'] }]
        : null,
      // Required for React Navigation and animations
      'react-native-reanimated/plugin',
    ].filter(Boolean) // Remove null values
  };
};

