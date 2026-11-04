import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, SITE_NOT_CONNECTED_EVENT } from '../services/api';
import { getStoredToken, setStoredToken, clearStoredToken } from '../utils/helpers';
import { nameOr } from '../utils/brand';
import { SiteStateContext, initialSiteState, normalizeSiteState } from '../utils/siteState';

const AuthContext = createContext();

/** "Continue for now" after a skip WPMaven did not record: this browser session only. */
export const CONTINUED_FOR_NOW_KEY = 'webmaven-setup-continued';
/** While a business is going live on this site, /status is asked again this often, for at most PUBLISH_POLL_MAX_MS. */
export const PUBLISH_POLL_MS = 30000;
export const PUBLISH_POLL_MAX_MS = 20 * 60 * 1000;

function readContinuedForNow() {
  try {
    return window.sessionStorage.getItem(CONTINUED_FOR_NOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // 'connected' | 'unreachable' | 'reconnect' | 'not_connected', from /status (1.2.9).
  const [connection, setConnection] = useState(null);
  // Why a reconnect is needed, when the site knows: 'unreadable' (1.6.0).
  const [connectionReason, setConnectionReason] = useState(null);
  const [apiReachable, setApiReachable] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    () => window.WEBMAVEN_WP_DATA?.onboardingCompleted !== false
  );
  // What the account says about this site's business (the site state): the
  // setup card, the next step, the links and one flag per screen. The page
  // brings the plugin's last answer; every /status read replaces it.
  const [siteState, setSiteState] = useState(() => initialSiteState());
  const [setupNeeded, setSetupNeeded] = useState(() => window.WEBMAVEN_WP_DATA?.setupNeeded === true);
  const [continuedForNow, setContinuedForNow] = useState(() => readContinuedForNow());
  const [skipFailed, setSkipFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** A /status answer of a connected site: whether setup is needed, and the state. */
  const applyStatus = useCallback((status) => {
    // For older readers: true unless the account says setup is needed.
    setOnboardingCompleted(status?.onboarding_completed !== false);
    if (status && status.site_state) setSiteState(normalizeSiteState(status.site_state));
    setSetupNeeded(status?.setup_needed === true);
  }, []);

  const checkAuthStatus = useCallback(async () => {
    try {
      setLoading(true);
      console.log('AuthContext: Checking authentication status with server...');
      
      // Check authentication status with server (token is stored server-side)
      const response = await api.getPluginStatus();
      console.log('AuthContext: Status response:', response);
      
          setConnection(response?.status?.connection ?? null);
          setConnectionReason(response?.status?.connection_reason ?? null);
          if (response?.success && response?.status?.authenticated) {
            console.log('AuthContext: Server confirms authentication');
            setIsAuthenticated(true);
            setApiReachable(response.status.api_reachable ?? false);
            applyStatus(response.status);
            // In the site's brand (1.2.31).
            setError(response.status.api_reachable ? null : `${nameOr('Your dashboard')} is not reachable right now.`);
          } else {
            console.log('AuthContext: Server confirms not authenticated');
            setIsAuthenticated(false);
            setApiReachable(false);
            setBackendConnected(false);
            setOnboardingCompleted(true);
            // A site that is not connected never needs setup.
            setSetupNeeded(false);
            clearStoredToken();
          }
    } catch (error) {
      // The status read itself failed (network, WordPress error): that says
      // nothing about the site's link, so the screen stays as it is (1.2.9).
      // It used to sign the owner out.
      console.error('AuthContext: Auth check failed:', error);
      setError('Could not read the connection status.');
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // The plugin said "this site is not connected" (1.2.9): re-read /status,
  // which alone decides whether Sign In shows. An API 401 on a proxied call
  // no longer signs anyone out (it used to, and looped the Sign In screen).
  useEffect(() => {
    let lastCheck = 0;
    const handleSiteNotConnected = () => {
      // Several screens may hear it at once: one re-read per 10 seconds.
      const now = Date.now();
      if (now - lastCheck < 10000) return;
      lastCheck = now;
      console.warn('AuthContext: The plugin reports the site is not connected, re-reading /status');
      checkAuthStatus();
    };
    window.addEventListener(SITE_NOT_CONNECTED_EVENT, handleSiteNotConnected);
    return () => window.removeEventListener(SITE_NOT_CONNECTED_EVENT, handleSiteNotConnected);
  }, [checkAuthStatus]);

  // Start authentication polling when not authenticated (matching legacy implementation)
  useEffect(() => {
    let pollInterval = null;
    
    const startAuthPolling = () => {
      console.log("AuthContext: Starting authentication polling...");
      
      const pollAuthStatus = async () => {
        try {
          const response = await api.getPluginStatus();
          console.log("AuthContext: Polling response:", response);
          
          if (response?.success && response?.status?.activated && response?.status?.authenticated) {
            console.log("AuthContext: Authentication detected during polling, updating state...");
            setConnection(response.status.connection ?? 'connected');
            setConnectionReason(response.status.connection_reason ?? null);
            setIsAuthenticated(true);
            setApiReachable(response.status.api_reachable ?? false);
            setBackendConnected(response.status.backend_connected || false);
            applyStatus(response.status);
            setError(null);
            clearInterval(pollInterval); // Stop polling
            // Note: Tab switching will be handled by the UI context
          }
        } catch (error) {
          console.error('AuthContext: Auth polling error:', error);
        }
      };
      
      // Start polling every 2 seconds (matching legacy implementation)
      pollInterval = setInterval(pollAuthStatus, 2000);
    };
    
    // Only start polling if not authenticated and not loading
    // This prevents unnecessary polling when already authenticated
    if (!isAuthenticated && !loading) {
      console.log("AuthContext: Starting polling - not authenticated and not loading");
      startAuthPolling();
    } else {
      console.log("AuthContext: Skipping polling - authenticated:", isAuthenticated, "loading:", loading);
    }
    
    // Cleanup function
    return () => {
      if (pollInterval) {
        console.log("AuthContext: Clearing polling interval");
        clearInterval(pollInterval);
      }
    };
  }, [isAuthenticated, loading, applyStatus]);

  /**
   * Ask the plugin to read the site state again now ("Check again", the tab
   * coming back, a business going live here). No spinner: the screen stays
   * until the answer replaces it.
   */
  const refreshStatus = useCallback(async () => {
    try {
      const response = await api.getPluginStatus({ refresh: true });
      if (response?.success && response?.status?.authenticated) {
        applyStatus(response.status);
      }
    } catch (error) {
      console.error('AuthContext: Status refresh failed:', error);
    }
  }, [applyStatus]);

  // While setup is needed, the owner is often in the dashboard in another
  // tab: coming back reads the state again.
  useEffect(() => {
    if (!setupNeeded || typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [setupNeeded, refreshStatus]);

  // A business going live on this site: read again every 30 seconds, for
  // 20 minutes at most, so the page moves on when it is done.
  const publishingHere = !!siteState.draft?.publishingHere;
  useEffect(() => {
    if (!publishingHere) return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > PUBLISH_POLL_MAX_MS) {
        clearInterval(timer);
        return;
      }
      refreshStatus();
    }, PUBLISH_POLL_MS);
    return () => clearInterval(timer);
  }, [publishingHere, refreshStatus]);

  const login = async (token) => {
    try {
      setStoredToken(token);
      setIsAuthenticated(true);
      setError(null);
      // Check backend connection after login
      await checkBackendConnection();
    } catch (error) {
      console.error('Login failed:', error);
      setError('Login failed');
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Call logout endpoint to clear server-side tokens
      await api.logout();
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Continue with local logout even if API fails
    } finally {
      // Clear local state and tokens
      clearStoredToken();
      setIsAuthenticated(false);
      setBackendConnected(false);
      setError(null);
    }
  };

  const checkBackendConnection = async () => {
    try {
      const response = await api.getPluginStatus();
      setBackendConnected(response?.backend_connected || false);
      return response?.backend_connected || false;
    } catch (error) {
      console.error('Backend connection check failed:', error);
      setBackendConnected(false);
      return false;
    }
  };

  /**
   * "Continue in WordPress": recorded on the account (the plugin's
   * /setup/skip). When WPMaven did not answer, nothing is recorded and
   * the card stays, saying so; continueForNow() then lets the owner in for
   * this browser session.
   */
  const skipOnboarding = useCallback(async () => {
    setSkipFailed(false);
    try {
      const response = await api.post('/setup/skip');
      if (response?.success) {
        if (response.site_state) setSiteState(normalizeSiteState(response.site_state));
        setSetupNeeded(false);
        setOnboardingCompleted(true);
        return true;
      }
    } catch (error) {
      console.error('AuthContext: Failed to record the skip:', error);
    }
    setSkipFailed(true);
    return false;
  }, []);

  const continueForNow = useCallback(() => {
    try {
      window.sessionStorage.setItem(CONTINUED_FOR_NOW_KEY, '1');
    } catch {
      // Private browsing: this page view only.
    }
    setContinuedForNow(true);
  }, []);

  const value = {
    // State
    isAuthenticated,
    connection,
    connectionReason,
    apiReachable,
    backendConnected,
    onboardingCompleted,
    siteState,
    setupNeeded,
    continuedForNow,
    skipFailed,
    loading,
    error,

    // Actions
    login,
    logout,
    checkAuthStatus,
    checkBackendConnection,
    skipOnboarding,
    continueForNow,
    refreshStatus,

    // Setters (for external updates)
    setIsAuthenticated,
    setApiReachable,
    setBackendConnected,
    setOnboardingCompleted,
    setError,
  };

  return (
    <AuthContext.Provider value={value}>
      <SiteStateContext.Provider value={siteState}>
        {children}
      </SiteStateContext.Provider>
    </AuthContext.Provider>
  );
}
