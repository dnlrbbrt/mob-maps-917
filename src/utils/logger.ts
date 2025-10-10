/**
 * Custom Logger Utility
 * 
 * Provides environment-aware logging integrated with Sentry crash reporting.
 * 
 * In development: All logs print to console
 * In production: Only errors and warnings print (info/debug are silent)
 *                Errors and warnings are automatically sent to Sentry
 * 
 * Note: The babel plugin will also remove console.log in production builds,
 * but this logger gives us more control and integrates with Sentry.
 */

import { captureException, captureMessage, addSentryBreadcrumb } from '../config/sentry';

const isDev = __DEV__;

export const logger = {
  /**
   * Log general information (only in development)
   * Use for debugging and development-only messages
   */
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },

  /**
   * Log informational messages (only in development)
   * Use for tracking application flow and state changes
   */
  info: (...args: any[]) => {
    if (isDev) {
      console.info(...args);
    }
  },

  /**
   * Log debug messages (only in development)
   * Use for detailed debugging information
   */
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },

  /**
   * Log warnings (always prints, even in production)
   * Use for recoverable errors and warnings
   * Automatically sent to Sentry in production
   */
  warn: (...args: any[]) => {
    console.warn(...args);
    // Send to Sentry in production
    if (!isDev) {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      captureMessage(message, 'warning');
    }
  },

  /**
   * Log errors (always prints, even in production)
   * Use for exceptions and critical errors
   * Automatically sent to Sentry in production
   */
  error: (...args: any[]) => {
    console.error(...args);
    // Send to Sentry in production
    if (!isDev) {
      // If first argument is an Error object, capture it properly
      if (args[0] instanceof Error) {
        const context = args.length > 1 ? {
          additionalInfo: args.slice(1).map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ).join(' ')
        } : undefined;
        captureException(args[0], context);
      } else {
        // Otherwise, create an Error from the message
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        captureException(new Error(message));
      }
    }
  },

  /**
   * Log with custom tag for filtering
   * Example: logger.tagged('AUTH', 'User logged in')
   */
  tagged: (tag: string, ...args: any[]) => {
    if (isDev) {
      console.log(`[${tag}]`, ...args);
    }
  },

  /**
   * Log API requests (only in development)
   * Use for tracking API calls and responses
   * Adds breadcrumb to Sentry for debugging
   */
  api: (method: string, url: string, data?: any) => {
    if (isDev) {
      console.log(`🌐 API [${method}]`, url, data || '');
    }
    // Add breadcrumb for Sentry (helps debug errors)
    addSentryBreadcrumb(`API ${method} ${url}`, 'api', data ? { data } : undefined);
  },

  /**
   * Log database operations (only in development)
   * Use for tracking Supabase queries
   * Adds breadcrumb to Sentry for debugging
   */
  db: (operation: string, table: string, data?: any) => {
    if (isDev) {
      console.log(`💾 DB [${operation}]`, table, data || '');
    }
    // Add breadcrumb for Sentry (helps debug errors)
    addSentryBreadcrumb(`DB ${operation} on ${table}`, 'database', data ? { data } : undefined);
  },

  /**
   * Log navigation events (only in development)
   * Use for tracking screen changes
   * Adds breadcrumb to Sentry for debugging
   */
  navigation: (screen: string, params?: any) => {
    if (isDev) {
      console.log(`📱 Navigation →`, screen, params || '');
    }
    // Add breadcrumb for Sentry (helps debug errors)
    addSentryBreadcrumb(`Navigate to ${screen}`, 'navigation', params ? { params } : undefined);
  },

  /**
   * Create a timer for performance tracking (only in development)
   * Returns a function to end the timer
   */
  time: (label: string) => {
    if (isDev) {
      console.time(label);
      return () => console.timeEnd(label);
    }
    return () => {}; // No-op in production
  },

  /**
   * Log table data (only in development)
   * Useful for displaying arrays/objects in a readable format
   */
  table: (data: any) => {
    if (isDev && console.table) {
      console.table(data);
    }
  }
};

// Export default for convenience
export default logger;

/**
 * Usage Examples:
 * 
 * import logger from '../utils/logger';
 * 
 * // Basic logging (dev only)
 * logger.log('User clicked button');
 * logger.info('Fetching user data...');
 * logger.debug('State:', state);
 * 
 * // Warnings and errors (always logged)
 * logger.warn('API response slow');
 * logger.error('Failed to load data', error);
 * 
 * // Tagged logging
 * logger.tagged('AUTH', 'User logged in');
 * 
 * // Specialized loggers
 * logger.api('GET', '/api/users');
 * logger.db('SELECT', 'profiles', { id: userId });
 * logger.navigation('ProfileScreen', { userId: 123 });
 * 
 * // Performance tracking
 * const endTimer = logger.time('DataLoad');
 * await fetchData();
 * endTimer(); // Logs: DataLoad: 234ms
 * 
 * // Table view
 * logger.table(users);
 */

