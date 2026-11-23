import React, { createContext, useContext, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  dispatchGmpQuotaExceeded,
  isGmpQuotaError,
  normalizeMapsApiKey,
} from '../utils/googleMapsConfig';

interface GoogleMapsConfigContextValue {
  apiKey: string;
  loading: boolean;
  ready: boolean;
}

const GoogleMapsConfigContext = createContext<GoogleMapsConfigContextValue>({
  apiKey: '',
  loading: false,
  ready: false,
});

export function useGoogleMapsConfig(): GoogleMapsConfigContextValue {
  return useContext(GoogleMapsConfigContext);
}

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  const envKey = normalizeMapsApiKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  const [apiKey, setApiKey] = useState<string>(envKey);
  const [loading, setLoading] = useState<boolean>(!envKey);

  useEffect(() => {
    if (envKey) {
      setApiKey(envKey);
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { configured?: boolean; apiKey?: string } | null) => {
        if (cancelled) return;
        const resolved = normalizeMapsApiKey(data?.apiKey);
        if (resolved) setApiKey(resolved);
      })
      .catch(() => {
        // Ignore network fetch errors on startup; UI gracefully checks `ready`
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [envKey]);

  const value: GoogleMapsConfigContextValue = {
    apiKey,
    loading,
    ready: Boolean(apiKey),
  };

  if (!apiKey) {
    return (
      <GoogleMapsConfigContext.Provider value={value}>
        {children}
      </GoogleMapsConfigContext.Provider>
    );
  }

  return (
    <GoogleMapsConfigContext.Provider value={value}>
      <APIProvider
        apiKey={apiKey}
        libraries={['places', 'marker', 'core']}
        language="en"
        region="IN"
        onError={(err) => {
          if (isGmpQuotaError(err)) {
            dispatchGmpQuotaExceeded();
          }
        }}
      >
        {children}
      </APIProvider>
    </GoogleMapsConfigContext.Provider>
  );
}
