import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, DoorOpen, Search, Users, X } from 'lucide-react';
import type { Employee, FlatUnit, Project, Tower } from '../types/avy';
import {
  type GlobalSearchResultItem,
  searchWorkspaceEntities,
} from '../utils/globalSearch';

interface GlobalHeaderSearchProps {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  onSelectResult: (item: GlobalSearchResultItem) => void;
}

export function GlobalHeaderSearch({
  projects,
  towers,
  flats,
  employees,
  onSelectResult,
}: GlobalHeaderSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(
    () =>
      searchWorkspaceEntities({
        query,
        projects,
        towers,
        flats,
        employees,
        limitPerGroup: 5,
      }),
    [query, projects, towers, flats, employees]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
        return;
      }

      if (!isEditable && event.key === '/') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, []);

  const handleSelect = (item: GlobalSearchResultItem) => {
    onSelectResult(item);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!open || results.ordered.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.ordered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.ordered.length) % results.ordered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results.ordered[activeIndex] || results.ordered[0];
      if (chosen) handleSelect(chosen);
    }
  };

  const showDropdown = open && query.trim().length > 0;

  const renderGroup = (
    groupLabel: string,
    Icon: React.ComponentType<{ className?: string }>,
    items: GlobalSearchResultItem[]
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="py-1.5" key={groupLabel}>
        <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
          <span>{groupLabel}</span>
          <span className="font-mono text-slate-400">({items.length})</span>
        </div>
        <div className="mt-0.5">
          {items.map((item) => {
            const globalIdx = results.ordered.findIndex((o) => o.key === item.key);
            const isHighlighted = globalIdx === activeIndex;
            return (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                data-testid={`global-search-item-${item.type}-${item.id}`}
                onMouseEnter={() => {
                  if (globalIdx >= 0) setActiveIndex(globalIdx);
                }}
                onClick={() => handleSelect(item)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                  isHighlighted ? 'bg-orange-50 text-slate-900' : 'hover:bg-slate-50 text-slate-900'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {item.subtitle}
                  </div>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-orange-800 shrink-0">
                  {item.code}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <Search
          className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          data-testid="global-header-search-input"
          aria-label="Global search projects, employees, or flat IDs"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search project, worker, flat ID..."
          className="w-full pl-8 pr-9 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-orange-600"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear global search"
            className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="hidden md:inline-block absolute right-2 text-[10px] font-mono text-slate-400 px-1 py-0.5 border border-slate-200 rounded bg-white"
          >
            /
          </span>
        )}
      </div>

      {showDropdown && (
        <div
          role="listbox"
          aria-label="Global search results"
          data-testid="global-header-search-results"
          className="absolute left-0 w-full sm:w-[400px] max-w-[calc(100vw-2rem)] mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto divide-y divide-slate-100"
        >
          {results.ordered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              No projects, employees, or flat IDs matched &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between gap-3 whitespace-nowrap">
                <span>
                  {results.totalCount} match{results.totalCount === 1 ? '' : 'es'} across workspace
                </span>
                <span className="font-mono">Enter to open</span>
              </div>
              {renderGroup('Projects', Building2, results.projects)}
              {renderGroup('Employees', Users, results.employees)}
              {renderGroup('Flats & Units', DoorOpen, results.flats)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
