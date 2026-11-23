import React, { useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Download,
  FileCode2,
  FilePlus2,
  History,
  Lock,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { devsecApi } from '../../utils/devsecApi';
import type { FileVersionSnapshot, RepoFileEntry } from '../../types/devsec';

interface SourceExplorerPanelProps {
  token: string;
  isOwner: boolean;
  canEditFrontend: boolean;
  canEditBackend: boolean;
  canDownloadSource: boolean;
  versions?: FileVersionSnapshot[];
  onRefreshDashboard?: () => void;
  onSessionInvalid?: () => void;
}

export function SourceExplorerPanel({
  token,
  isOwner,
  canEditFrontend,
  canEditBackend,
  canDownloadSource,
  versions = [],
  onRefreshDashboard,
  onSessionInvalid,
}: SourceExplorerPanelProps) {
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [filterText, setFilterText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('other');
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [commitSummary, setCommitSummary] = useState<string>('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('src/utils/');
  const [newFileContent, setNewFileContent] = useState('// Created via AVY INFRA DevSec Portal\n');

  const handleApiError = (err: unknown) => {
    const e = err as Error & { status?: number };
    if (e.status === 401 && onSessionInvalid) {
      onSessionInvalid();
      return;
    }
    setErrorMsg(e.message || 'Operation failed');
  };

  const loadFiles = async () => {
    setLoadingFiles(true);
    setErrorMsg('');
    try {
      const res = await devsecApi.listFiles(token);
      setFiles(res.files);
      if (!selectedPath && res.files.length > 0) {
        const defaultFile =
          res.files.find((f) => f.path === 'src/App.tsx') || res.files[0];
        void openFile(defaultFile.path);
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const openFile = async (relPath: string) => {
    setLoadingContent(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await devsecApi.readFile(token, relPath);
      setSelectedPath(res.path);
      setSelectedCategory(res.category);
      setFileContent(res.content);
      setOriginalContent(res.content);
      setCommitSummary('');
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoadingContent(false);
    }
  };

  const canEditSelected = useMemo(() => {
    if (isOwner) return true;
    if (selectedCategory === 'frontend') return canEditFrontend;
    if (selectedCategory === 'backend') return canEditBackend;
    return false;
  }, [isOwner, selectedCategory, canEditFrontend, canEditBackend]);

  const filteredFiles = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return files.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, filterText, categoryFilter]);

  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await devsecApi.writeFile(token, {
        path: selectedPath,
        content: fileContent,
        summary: commitSummary.trim() || `Updated ${selectedPath}`,
      });
      setOriginalContent(fileContent);
      setCommitSummary('');
      setStatusMsg(`Saved ${selectedPath} and recorded version snapshot.`);
      await loadFiles();
      onRefreshDashboard?.();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim()) return;
    setSaving(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await devsecApi.writeFile(token, {
        path: newFilePath.trim(),
        content: newFileContent,
        summary: `Created ${newFilePath.trim()}`,
      });
      setNewFileOpen(false);
      setStatusMsg(`Created ${newFilePath.trim()}`);
      await loadFiles();
      await openFile(newFilePath.trim());
      onRefreshDashboard?.();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      await devsecApi.deleteFile(token, selectedPath);
      setStatusMsg(`Deleted ${selectedPath} (rollback snapshot saved).`);
      setSelectedPath('');
      setFileContent('');
      setOriginalContent('');
      await loadFiles();
      onRefreshDashboard?.();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadSource = async () => {
    setErrorMsg('');
    setStatusMsg('');
    try {
      const bundle = await devsecApi.downloadSourceBundle(token);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `avy-infra-source-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMsg('Audited source bundle downloaded (secrets & .env files excluded).');
      onRefreshDashboard?.();
    } catch (err) {
      handleApiError(err);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await devsecApi.restoreVersion(token, versionId);
      setStatusMsg(`Restored ${res.snapshot.filePath} from previous snapshot.`);
      await loadFiles();
      if (selectedPath === res.snapshot.filePath) {
        await openFile(res.snapshot.filePath);
      }
      onRefreshDashboard?.();
    } catch (err) {
      handleApiError(err);
    }
  };

  const isDirty = fileContent !== originalContent;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Code2 className="w-4 h-4 text-orange-700" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Protected Repository Explorer
            </div>
            <div className="text-xs text-slate-500">
              Environment files (.env), vault keys, and git metadata are hidden from source browsing.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(isOwner || canEditFrontend || canEditBackend) && (
            <button
              type="button"
              onClick={() => setNewFileOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200"
            >
              <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New File</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadSource}
            data-testid="devsec-download-source-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border ${
              isOwner || canDownloadSource
                ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
            }`}
            title={
              isOwner || canDownloadSource
                ? 'Download audited source bundle'
                : 'Requires Download Source permission (server will enforce)'
            }
          >
            {isOwner || canDownloadSource ? (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>Download Source Bundle</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
          {statusMsg}
        </div>
      )}

      {newFileOpen && (
        <form
          onSubmit={handleCreateFile}
          className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-900">Create Repository File</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Relative Path</label>
              <input
                type="text"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="src/utils/helper.ts"
                className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
              >
                Create File
              </button>
              <button
                type="button"
                onClick={() => setNewFileOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md"
              >
                Cancel
              </button>
            </div>
          </div>
          <textarea
            rows={4}
            value={newFileContent}
            onChange={(e) => setNewFileContent(e.target.value)}
            className="w-full p-2.5 text-xs font-mono border border-slate-300 rounded-md"
          />
        </form>
      )}

      {/* Main Split Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* File Tree */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col max-h-[540px]">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter source files..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {['all', 'frontend', 'backend', 'schema', 'config'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded border capitalize ${
                    categoryFilter === cat
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loadingFiles ? (
              <div className="p-4 text-xs text-slate-500">Scanning repository...</div>
            ) : (
              filteredFiles.map((f) => {
                const active = selectedPath === f.path;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => void openFile(f.path)}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                      active ? 'bg-orange-50 text-orange-950 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <FileCode2 className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="font-mono truncate">{f.path}</span>
                    </span>
                    <span className="text-[10px] font-mono uppercase text-slate-400 shrink-0">
                      {f.category}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Code Viewer / Editor */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-mono font-semibold text-slate-900 truncate">
                {selectedPath || 'Select a file to inspect'}
              </div>
              {selectedPath && (
                <div className="text-[11px] text-slate-500">
                  Scope: <span className="font-medium uppercase">{selectedCategory}</span> ·{' '}
                  {canEditSelected ? 'Read & Write Authorized' : 'Read-Only Access'}
                </div>
              )}
            </div>

            {selectedPath && (
              <div className="flex items-center gap-2">
                {canEditSelected ? (
                  <>
                    <input
                      type="text"
                      value={commitSummary}
                      onChange={(e) => setCommitSummary(e.target.value)}
                      placeholder="Change note..."
                      className="px-2.5 py-1 text-xs border border-slate-300 rounded-md w-40"
                    />
                    <button
                      type="button"
                      disabled={saving || !isDirty}
                      onClick={handleSave}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Save</span>
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleDeleteFile}
                        title="Delete file (Owner only)"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded">
                    <Lock className="w-3 h-3" aria-hidden="true" />
                    <span>Read-Only</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {loadingContent ? (
            <div className="p-6 text-xs text-slate-500">Loading source file...</div>
          ) : (
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              readOnly={!canEditSelected}
              spellCheck={false}
              className="w-full flex-1 min-h-[460px] p-4 text-xs font-mono leading-relaxed text-slate-900 bg-white focus:outline-none resize-y"
            />
          )}
        </div>
      </div>

      {/* Owner Version History & Rollback */}
      {isOwner && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">
                Source Code Version History &amp; Rollback
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {versions.length} snapshots
            </span>
          </div>
          {versions.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">
              No source modifications recorded yet. Every file edit or deletion automatically records a rollback snapshot.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Timestamp</th>
                    <th className="px-4 py-2 font-semibold">File Path</th>
                    <th className="px-4 py-2 font-semibold">Change</th>
                    <th className="px-4 py-2 font-semibold">Author</th>
                    <th className="px-4 py-2 font-semibold">Summary</th>
                    <th className="px-4 py-2 font-semibold text-right">Rollback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.slice(0, 20).map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(v.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-900">{v.filePath}</td>
                      <td className="px-4 py-2 uppercase text-[11px] font-semibold text-slate-700">
                        {v.changeType}
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700">
                        {v.editedBy} ({v.editedByRole})
                      </td>
                      <td className="px-4 py-2 text-slate-600">{v.summary}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleRestoreVersion(v.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>Restore Prior</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
