export function normalizeMapsApiKey(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === 'MY_GOOGLE_MAPS_API_KEY') return '';
  return trimmed;
}

export function isGmpQuotaError(err: unknown): boolean {
  if (!err) return false;
  const text =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? `${err.name} ${err.message}`
        : JSON.stringify(err);
  const upper = text.toUpperCase();
  return (
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('OVER_QUERY_LIMIT') ||
    upper.includes('OVERQUOTAMAPERROR') ||
    upper.includes('QUOTAEXCEEDEDERROR') ||
    upper.includes('429')
  );
}

export function dispatchGmpQuotaExceeded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

export function buildGoogleMapsPlaceUrl(opts: {
  query: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}): string {
  const params = new URLSearchParams({ api: '1' });
  if (typeof opts.lat === 'number' && typeof opts.lng === 'number') {
    params.set('query', `${opts.lat},${opts.lng}`);
  } else {
    params.set('query', opts.query.trim() || 'Hyderabad');
  }
  if (opts.placeId) {
    params.set('query_place_id', opts.placeId);
  }
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
