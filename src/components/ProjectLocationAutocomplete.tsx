import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import { dispatchGmpQuotaExceeded, isGmpQuotaError } from '../utils/googleMapsConfig';
import { useGoogleMapsConfig } from './GoogleMapsProvider';

interface ProjectLocationAutocompleteProps {
  id: string;
  value: string;
  onChange: (nextLocation: string) => void;
  onPlaceSelected?: (place: { formattedAddress: string; placeId: string }) => void;
  placeholder?: string;
}

export function ProjectLocationAutocomplete({
  id,
  value,
  onChange,
  onPlaceSelected,
  placeholder = 'e.g. Financial District, Hyderabad',
}: ProjectLocationAutocompleteProps) {
  const { ready } = useGoogleMapsConfig();
  if (!ready) {
    return (
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
      />
    );
  }

  return (
    <PlacesLocationAutocompleteInner
      id={id}
      value={value}
      onChange={onChange}
      onPlaceSelected={onPlaceSelected}
      placeholder={placeholder}
    />
  );
}

function PlacesLocationAutocompleteInner({
  id,
  value,
  onChange,
  onPlaceSelected,
  placeholder,
}: ProjectLocationAutocompleteProps) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!placesLib || !focused) return;
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        sessionToken: sessionTokenRef.current,
        region: 'in',
      })
        .then((res) => {
          setSuggestions(res.suggestions || []);
          setOpen((res.suggestions || []).length > 0);
        })
        .catch((err) => {
          if (isGmpQuotaError(err)) {
            dispatchGmpQuotaExceeded();
          }
          setSuggestions([]);
        });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [placesLib, value, focused]);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    const pred = suggestion.placePrediction;
    if (!pred) return;

    const fallbackText = pred.text?.text || value;
    try {
      const place = pred.toPlace();
      await place.fetchFields({
        fields: ['id', 'displayName', 'formattedAddress', 'location'],
      });
      const resolvedAddress = place.formattedAddress || fallbackText;
      const resolvedId = place.id || pred.placeId || '';
      onChange(resolvedAddress);
      if (onPlaceSelected && resolvedId) {
        onPlaceSelected({ formattedAddress: resolvedAddress, placeId: resolvedId });
      }
    } catch (err) {
      if (isGmpQuotaError(err)) {
        dispatchGmpQuotaExceeded();
      }
      onChange(fallbackText);
    } finally {
      sessionTokenRef.current = null;
      setSuggestions([]);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <MapPin
          className="w-3.5 h-3.5 text-orange-700 absolute left-2.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id={id}
          type="text"
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            onChange(e.target.value);
            setFocused(true);
          }}
          placeholder={placeholder}
          className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Site location suggestions"
          className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto divide-y divide-slate-100"
        >
          {suggestions.map((suggestion, idx) => (
            <li key={suggestion.placePrediction?.placeId || idx}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleSelectSuggestion(suggestion);
                }}
                className="w-full text-left px-3 py-2 text-xs text-slate-800 hover:bg-orange-50 flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-orange-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="line-clamp-2">
                  {suggestion.placePrediction?.text?.text || 'Selected Location'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
