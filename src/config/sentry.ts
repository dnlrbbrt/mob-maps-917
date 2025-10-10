/**
 * Sentry Configuration
 * 
 * Crash reporting and error tracking for production environments.
 * Integrated with ErrorBoundary and Logger utilities.
 */

import * as Sentry from '@sentry/react-native';

// Environment detection
const isDev = __DEV__;
const isProduction = process.env.NODE_ENV === 'production';

// Sentry DSN (Data Source Name)
const SENTRY_DSN = 'https://55127012027315a7040648baeaeb0d73@o4510167249649664.ingest.us.sentry.io/4510167290675200';

// Determine if Sentry should be enabled
// By default: enabled in production, disabled in development
const SENTRY_ENABLED = isProduction && !isDev;

/**
 * Initialize Sentry
 * Call this once at app startup (in App.tsx)
 */
export function initializeSentry() {
  if (!SENTRY_ENABLED) {
    console.log('🔍 Sentry: Disabled in development mode');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    
    // Enable or disable crash reporting
    enabled: SENTRY_ENABLED,
    
    // Environment name
    environment: isProduction ? 'production' : isDev ? 'development' : 'staging',
    
    // App version (update this when you release new versions)
    release: 'mob-maps@1.0.0',
    dist: '1',
    
    // Performance monitoring sample rate (0.0 to 1.0)
    // Set to 0.1 (10%) in production to reduce overhead
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    
    // Capture unhandled promise rejections
    enableAutoSessionTracking: true,
    
    // Session tracking
    sessionTrackingIntervalMillis: 30000, // 30 seconds
    
    // Enable native crash reporting (iOS/Android)
    enableNative: true,
    enableNativeCrashHandling: true,
    
    // Enable automatic breadcrumbs
    enableAutoPerformanceTracking: true,
    
    // Integrations
    integrations: [
      new Sentry.ReactNativeTracing({
        // Track navigation performance
        routingInstrumentation: new Sentry.ReactNavigationInstrumentation(),
      }),
    ],
    
    // Before sending an event, you can modify it here
    beforeSend(event, hint) {
      // Don't send events in development
      if (isDev) {
        console.log('🔍 Sentry Event (not sent in dev):', event);
        return null;
      }
      
      // You can filter out certain errors here
      // For example, network errors that aren't critical:
      // if (event.exception?.values?.[0]?.type === 'NetworkError') {
      //   return null;
      // }
      
      return event;
    },
    
    // Before sending a breadcrumb, you can modify it here
    beforeBreadcrumb(breadcrumb, hint) {
      // Filter out console breadcrumbs to reduce noise
      if (breadcrumb.category === 'console') {
        return null;
      }
      return breadcrumb;
    },
  });

  console.log('✅ Sentry: Initialized for production');
}

/**
 * Set user context for crash reports
 * Call this after user logs in
 */
export function setSentryUser(userId: string, email?: string, username?: string) {
  if (!SENTRY_ENABLED) return;
  
  Sentry.setUser({
    id: userId,
    email,
    username,
  });
}

/**
 * Clear user context
 * Call this when user logs out
 */
export function clearSentryUser() {
  if (!SENTRY_ENABLED) return;
  
  Sentry.setUser(null);
}

/**
 * Add custom context to crash reports
 */
export function setSentryContext(key: string, value: any) {
  if (!SENTRY_ENABLED) return;
  
  Sentry.setContext(key, value);
}

/**
 * Add a breadcrumb (user action tracking)
 */
export function addSentryBreadcrumb(message: string, category?: string, data?: any) {
  if (!SENTRY_ENABLED) return;
  
  Sentry.addBreadcrumb({
    message,
    category: category || 'user-action',
    level: 'info',
    data,
  });
}

/**
 * Manually capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (!SENTRY_ENABLED) {
    console.error('🔍 Sentry Exception (not sent in dev):', error, context);
    return;
  }
  
  if (context) {
    Sentry.withScope((scope) => {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Manually capture a message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (!SENTRY_ENABLED) {
    console.log(`🔍 Sentry Message (not sent in dev) [${level}]:`, message);
    return;
  }
  
  Sentry.captureMessage(message, level);
}

/**
 * Check if Sentry is enabled
 */
export function isSentryEnabled(): boolean {
  return SENTRY_ENABLED;
}

// Export Sentry instance for advanced usage
export { Sentry };

// Default export
export default {
  initialize: initializeSentry,
  setUser: setSentryUser,
  clearUser: clearSentryUser,
  setContext: setSentryContext,
  addBreadcrumb: addSentryBreadcrumb,
  captureException,
  captureMessage,
  isEnabled: isSentryEnabled,
};

