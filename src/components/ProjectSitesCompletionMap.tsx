import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Building2,
  ExternalLink,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import type { FlatUnit, Project, TileZoneDefinition, Tower } from '../types/avy';
import {
  buildGoogleMapsPlaceUrl,
  dispatchGmpQuotaExceeded,
  isGmpQuotaError,
} from '../utils/googleMapsConfig';
import {
  computeProjectCompletionSeries,
  type ProjectCompletionPoint,
} from '../utils/operations';
import { useGoogleMapsConfig } from './GoogleMapsProvider';

interface ResolvedSiteLocation {
  projectId: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
}

interface ProjectSitesCompletionMapProps {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  tileZoneCatalog?: TileZoneDefinition[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onSaveProjectPlaceId?: (projectId: string, placeId: string) => void;
  onCloseModal?: () => void;
  compact?: boolean;
}

export function ProjectSitesCompletionMap({
  projects,
  towers,
  flats,
  tileZoneCatalog,
  selectedProjectId,
  onSelectProject,
  onSaveProjectPlaceId,
  onCloseModal,
  compact = false,
}: ProjectSitesCompletionMapProps) {
  const { ready, loading } = useGoogleMapsConfig();

  const completionPoints = useMemo(
    () =>
      computeProjectCompletionSeries({
        projects,
        towers,
        flats,
        tileZoneCatalog,
        onlyActive: false,
      }),
    [projects, towers, flats, tileZoneCatalog]
  );

  const activeCompletionPoints = useMemo(
    () => completionPoints.filter((p) => p.status === 'active'),
    [completionPoints]
  );

  const visiblePoints =
    activeCompletionPoints.length > 0 ? activeCompletionPoints : completionPoints;

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Initializing Google Maps configuration...
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="project-sites-completion-map">
      {/* Completion Color Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs">
        <div className="flex flex-wrap items-center gap-4 text-slate-700">
          <span className="font-semibold text-slate-900">Completion Pin Legend:</span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0"
              style={{ backgroundColor: '#16a34a' }}
              aria-hidden="true"
            />
            <span>On Track (75%+)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0"
              style={{ backgroundColor: '#d97706' }}
              aria-hidden="true"
            />
            <span>In Progress (35–74%)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0"
              style={{ backgroundColor: '#dc2626' }}
              aria-hidden="true"
            />
            <span>Early Stage (&lt;35%)</span>
          </span>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-500">
          Showing {visiblePoints.length} site{visiblePoints.length === 1 ? '' : 's'}
        </div>
      </div>

      {!ready ? (
        <div className="p-4 sm:p-5 space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
            Interactive map canvas requires a Google Maps API key in this environment. Below is each active project&apos;s live completion tier and direct Google Maps link.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visiblePoints.map((pt) => {
              const proj = projects.find((p) => p.id === pt.projectId);
              const isSelected = pt.projectId === selectedProjectId;
              return (
                <div
                  key={pt.projectId}
                  className={`p-3.5 rounded-lg border transition-colors ${
                    isSelected
                      ? 'bg-orange-50/70 border-orange-400'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {pt.projectName}
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {pt.location || 'Site location'}
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 text-xs font-mono font-bold tabular-nums text-white rounded shrink-0"
                      style={{ backgroundColor: pt.colorHex }}
                    >
                      {pt.completionPct}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-sm overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pt.completionPct}%`,
                        backgroundColor: pt.colorHex,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 font-mono tabular-nums">
                    <span>
                      {pt.completedFlats}/{pt.totalFlats} flats · {pt.completedZones}/{pt.totalZones} zones
                    </span>
                    <span>{pt.towersCount}T</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProject(pt.projectId);
                        onCloseModal?.();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
                    >
                      <Building2 className="w-3 h-3" aria-hidden="true" />
                      <span>Focus Matrix</span>
                    </button>
                    <a
                      href={buildGoogleMapsPlaceUrl({
                        query: `${pt.projectName}, ${pt.location}`,
                        placeId: proj?.placeId,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-800 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      <span>Open Google Maps</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ProjectSitesInteractiveCanvas
          projects={projects}
          points={visiblePoints}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onSaveProjectPlaceId={onSaveProjectPlaceId}
          onCloseModal={onCloseModal}
          compact={compact}
        />
      )}
    </div>
  );
}

function ProjectSitesInteractiveCanvas({
  projects,
  points,
  selectedProjectId,
  onSelectProject,
  onSaveProjectPlaceId,
  onCloseModal,
  compact,
}: {
  projects: Project[];
  points: ProjectCompletionPoint[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onSaveProjectPlaceId?: (projectId: string, placeId: string) => void;
  onCloseModal?: () => void;
  compact: boolean;
}) {
  const apiStatus = useApiLoadingStatus();
  const placesLib = useMapsLibrary('places');
  const [resolvedMap, setResolvedMap] = useState<Record<string, ResolvedSiteLocation>>({});
  const [resolving, setResolving] = useState(false);
  const [activePinId, setActivePinId] = useState<string>(
    selectedProjectId || points[0]?.projectId || ''
  );
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (
      apiStatus === APILoadingStatus.AUTH_FAILURE ||
      apiStatus === APILoadingStatus.FAILED
    ) {
      dispatchGmpQuotaExceeded();
      setLookupError('Unable to load Google Maps tiles. Please check your network or API quota.');
    }
  }, [apiStatus]);

  const targetProjects = useMemo(() => {
    const ids = new Set(points.map((pt) => pt.projectId));
    return projects.filter((p) => ids.has(p.id));
  }, [projects, points]);

  const resolveProjectLocations = useCallback(async () => {
    if (!placesLib || targetProjects.length === 0) return;
    setResolving(true);
    setLookupError(null);

    try {
      const updates: Record<string, ResolvedSiteLocation> = {};
      await Promise.all(
        targetProjects.map(async (proj) => {
          try {
            if (proj.placeId) {
              const place = new placesLib.Place({ id: proj.placeId });
              await place.fetchFields({
                fields: ['id', 'displayName', 'formattedAddress', 'location'],
              });
              if (place.location) {
                updates[proj.id] = {
                  projectId: proj.id,
                  lat: place.location.lat(),
                  lng: place.location.lng(),
                  formattedAddress: place.formattedAddress || proj.location,
                  placeId: place.id || proj.placeId,
                };
                return;
              }
            }

            const query = `${proj.name}, ${proj.location}`.trim();
            if (!query) return;

            const { places } = await placesLib.Place.searchByText({
              textQuery: query,
              fields: ['id', 'displayName', 'formattedAddress', 'location'],
              maxResultCount: 1,
              region: 'in',
            });

            const match = places?.[0];
            if (match?.location) {
              updates[proj.id] = {
                projectId: proj.id,
                lat: match.location.lat(),
                lng: match.location.lng(),
                formattedAddress: match.formattedAddress || proj.location,
                placeId: match.id || undefined,
              };
              if (match.id && !proj.placeId && onSaveProjectPlaceId) {
                onSaveProjectPlaceId(proj.id, match.id);
              }
            }
          } catch (err) {
            if (isGmpQuotaError(err)) {
              dispatchGmpQuotaExceeded();
              setLookupError('Google Maps Platform quota limit reached while resolving project addresses.');
            }
          }
        })
      );

      if (Object.keys(updates).length > 0) {
        setResolvedMap((prev) => ({ ...prev, ...updates }));
      }
    } finally {
      setResolving(false);
    }
  }, [placesLib, targetProjects, onSaveProjectPlaceId]);

  useEffect(() => {
    void resolveProjectLocations();
  }, [resolveProjectLocations]);

  const resolvedList = useMemo(
    () =>
      points
        .map((pt) => resolvedMap[pt.projectId])
        .filter((item): item is ResolvedSiteLocation => Boolean(item)),
    [points, resolvedMap]
  );

  const activeSite = resolvedMap[activePinId] || resolvedList[0] || null;
  const defaultCenter = activeSite
    ? { lat: activeSite.lat, lng: activeSite.lng }
    : { lat: 17.385, lng: 78.4867 };

  const mapHeightClass = compact
    ? 'h-[360px] lg:h-[400px]'
    : 'h-[420px] lg:h-[500px]';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
      {/* Sidebar: Sites & Completion Status */}
      <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col max-h-72 lg:max-h-[500px] overflow-y-auto bg-slate-50/70">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-white sticky top-0 z-10">
          <span className="text-xs font-semibold text-slate-800">
            Active Sites ({points.length})
          </span>
          <button
            type="button"
            onClick={() => void resolveProjectLocations()}
            disabled={resolving}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${resolving ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{resolving ? 'Locating...' : 'Refresh Pins'}</span>
          </button>
        </div>

        {lookupError && (
          <div className="m-3 p-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md">
            {lookupError}
          </div>
        )}

        <div className="divide-y divide-slate-200">
          {points.map((pt) => {
            const proj = projects.find((p) => p.id === pt.projectId);
            const loc = resolvedMap[pt.projectId];
            const isSelected = activePinId === pt.projectId;

            return (
              <div
                key={pt.projectId}
                className={`p-3.5 transition-colors ${
                  isSelected ? 'bg-orange-50/90' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setActivePinId(pt.projectId)}
                    className="text-left min-w-0 flex-1"
                  >
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {pt.projectName}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      {loc?.formattedAddress || pt.location || 'Address pending'}
                    </div>
                  </button>
                  <span
                    className="px-2 py-0.5 text-[11px] font-mono font-bold tabular-nums text-white rounded shrink-0"
                    style={{ backgroundColor: pt.colorHex }}
                  >
                    {pt.completionPct}%
                  </span>
                </div>

                <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-sm overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${pt.completionPct}%`, backgroundColor: pt.colorHex }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                  <span>{pt.tierLabel}</span>
                  <span>
                    {pt.completedFlats}/{pt.totalFlats} flats · {pt.towersCount}T
                  </span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(pt.projectId);
                      onCloseModal?.();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
                  >
                    <Building2 className="w-3 h-3" aria-hidden="true" />
                    <span>Open Matrix</span>
                  </button>
                  <a
                    href={buildGoogleMapsPlaceUrl({
                      query: `${pt.projectName}, ${pt.location}`,
                      placeId: loc?.placeId || proj?.placeId,
                      lat: loc?.lat,
                      lng: loc?.lng,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-orange-800"
                  >
                    <Navigation className="w-3 h-3" aria-hidden="true" />
                    <span>Directions</span>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Google Map Canvas (protected from CSS dark-mode inversion) */}
      <div className={`lg:col-span-8 relative no-dark-invert w-full bg-slate-100 ${mapHeightClass}`}>
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={defaultCenter}
          defaultZoom={resolvedList.length > 0 ? 11 : 5}
          gestureHandling="greedy"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          <CompletionMapBoundsSync sites={resolvedList} activeSite={activeSite} />
          {points.map((pt) => {
            const loc = resolvedMap[pt.projectId];
            const proj = projects.find((p) => p.id === pt.projectId);
            if (!loc || !proj) return null;
            return (
              <CompletionSiteMarker
                key={pt.projectId}
                point={pt}
                project={proj}
                location={loc}
                isOpen={activePinId === pt.projectId}
                onSelect={() => setActivePinId(pt.projectId)}
                onCloseInfoWindow={() => setActivePinId('')}
                onSwitchProject={() => {
                  onSelectProject(pt.projectId);
                  onCloseModal?.();
                }}
              />
            );
          })}
        </GoogleMap>
      </div>
    </div>
  );
}

function CompletionMapBoundsSync({
  sites,
  activeSite,
}: {
  sites: ResolvedSiteLocation[];
  activeSite: ResolvedSiteLocation | null;
}) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map) return;
    if (activeSite) {
      map.panTo({ lat: activeSite.lat, lng: activeSite.lng });
      if ((map.getZoom() || 0) < 12) {
        map.setZoom(13);
      }
      return;
    }
    if (sites.length > 1 && coreLib) {
      const bounds = new coreLib.LatLngBounds();
      sites.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
      map.fitBounds(bounds, 48);
    }
  }, [map, coreLib, sites, activeSite]);

  return null;
}

function CompletionSiteMarker({
  point,
  project,
  location,
  isOpen,
  onSelect,
  onCloseInfoWindow,
  onSwitchProject,
}: {
  point: ProjectCompletionPoint;
  project: Project;
  location: ResolvedSiteLocation;
  isOpen: boolean;
  onSelect: () => void;
  onCloseInfoWindow: () => void;
  onSwitchProject: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: location.lat, lng: location.lng }}
        title={`${project.name} (${point.completionPct}% Complete)`}
        onClick={onSelect}
      >
        <Pin
          background={point.colorHex}
          borderColor={point.borderHex}
          glyphColor="#ffffff"
          glyph={`${point.completionPct}%`}
          scale={isOpen ? 1.25 : 1.05}
        />
      </AdvancedMarker>
      {isOpen && marker && (
        <InfoWindow anchor={marker} maxWidth={280} onCloseClick={onCloseInfoWindow}>
          <div className="p-1 text-slate-900 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-900">{project.name}</div>
              <span
                className="px-1.5 py-0.5 text-[10px] font-mono font-bold text-white rounded shrink-0"
                style={{ backgroundColor: point.colorHex }}
              >
                {point.completionPct}%
              </span>
            </div>
            <div className="text-[11px] text-slate-600 leading-snug">
              {location.formattedAddress}
            </div>
            <div className="text-[11px] text-slate-700 font-mono">
              {point.completedFlats}/{point.totalFlats} flats · {point.completedZones}/{point.totalZones} zones · {point.towersCount}T
            </div>
            <div className="text-[11px] text-slate-500">
              {project.clientName} · {point.tierLabel}
            </div>
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={onSwitchProject}
                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
              >
                Open Matrix
              </button>
              <a
                href={buildGoogleMapsPlaceUrl({
                  query: `${project.name}, ${location.formattedAddress}`,
                  placeId: location.placeId,
                  lat: location.lat,
                  lng: location.lng,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-700 hover:underline"
              >
                <span>Open Maps</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
