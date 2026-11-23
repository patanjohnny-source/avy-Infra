import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsPlaceUrl,
  isGmpQuotaError,
  normalizeMapsApiKey,
} from './googleMapsConfig.ts';

test('normalizeMapsApiKey strips whitespace and ignores placeholder token', () => {
  assert.equal(normalizeMapsApiKey(''), '');
  assert.equal(normalizeMapsApiKey('MY_GOOGLE_MAPS_API_KEY'), '');
  assert.equal(normalizeMapsApiKey('  AIzaTestKey123  '), 'AIzaTestKey123');
});

test('isGmpQuotaError detects quota errors without false positives on empty results', () => {
  assert.equal(isGmpQuotaError(new Error('RESOURCE_EXHAUSTED: daily cap reached')), true);
  assert.equal(isGmpQuotaError({ status: 'OVER_QUERY_LIMIT' }), true);
  assert.equal(isGmpQuotaError('HTTP 429 Too Many Requests'), true);
  assert.equal(isGmpQuotaError('OverQuotaMapError'), true);
  assert.equal(isGmpQuotaError(new Error('ZERO_RESULTS')), false);
  assert.equal(isGmpQuotaError(new Error('Network request failed')), false);
  assert.equal(isGmpQuotaError(null), false);
});

test('buildGoogleMapsPlaceUrl includes coordinates or text query and placeId cleanly', () => {
  const withPlaceId = buildGoogleMapsPlaceUrl({
    query: 'Skyline Heights Residency, Gachibowli, Hyderabad',
    placeId: 'ChIJxyz123',
    lat: 17.4401,
    lng: 78.3489,
  });
  assert.ok(withPlaceId.startsWith('https://www.google.com/maps/search/?'));
  assert.ok(withPlaceId.includes('query=17.4401%2C78.3489'));
  assert.ok(withPlaceId.includes('query_place_id=ChIJxyz123'));

  const textOnly = buildGoogleMapsPlaceUrl({
    query: 'Kokapet, Hyderabad',
  });
  assert.ok(textOnly.includes('query=Kokapet%2C+Hyderabad'));
  assert.ok(!textOnly.includes('query_place_id='));
});
