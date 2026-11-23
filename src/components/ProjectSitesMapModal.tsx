import React from 'react';
import { MapPin, X } from 'lucide-react';
import type { FlatUnit, Project, TileZoneDefinition, Tower } from '../types/avy';
import { ProjectSitesCompletionMap } from './ProjectSitesCompletionMap';

interface ProjectSitesMapModalProps {
  isOpen: boolean;
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  tileZoneCatalog?: TileZoneDefinition[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onSaveProjectPlaceId?: (projectId: string, placeId: string) => void;
  onClose: () => void;
}

export function ProjectSitesMapModal({
  isOpen,
  projects,
  towers,
  flats,
  tileZoneCatalog,
  selectedProjectId,
  onSelectProject,
  onSaveProjectPlaceId,
  onClose,
}: ProjectSitesMapModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-sites-map-title"
      data-testid="project-sites-map-modal"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-orange-700 shrink-0" aria-hidden="true" />
              <h2
                id="project-sites-map-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Project Sites Interactive Map (Completion Status Pins)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Color-coded active construction pins by tile completion percentage, site coordinates, and direct navigation links powered by Google Maps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project sites map"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <ProjectSitesCompletionMap
            projects={projects}
            towers={towers}
            flats={flats}
            tileZoneCatalog={tileZoneCatalog}
            selectedProjectId={selectedProjectId}
            onSelectProject={onSelectProject}
            onSaveProjectPlaceId={onSaveProjectPlaceId}
            onCloseModal={onClose}
          />
        </div>
      </div>
    </div>
  );
}
