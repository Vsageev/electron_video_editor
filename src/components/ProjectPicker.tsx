import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';

interface Props {
  onClose: () => void;
}

export default function ProjectPicker({ onClose }: Props) {
  const [projects, setProjects] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const createProject = useEditorStore((s) => s.createProject);
  const openProject = useEditorStore((s) => s.openProject);
  const currentProject = useEditorStore((s) => s.currentProject);

  const refresh = useCallback(async () => {
    const list = await window.api.listProjects();
    setProjects(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    if (/[/\\]/.test(name) || name.startsWith('.')) return;
    await createProject(name);
    onClose();
  }, [newName, createProject, onClose]);

  const handleOpen = useCallback(
    async (name: string) => {
      await openProject(name);
      onClose();
    },
    [openProject, onClose],
  );

  const handleDelete = useCallback(
    async (name: string) => {
      setDeletingName(name);
    },
    [],
  );

  const confirmDelete = useCallback(
    async (name: string) => {
      await window.api.deleteProject(name);
      setDeletingName(null);
      if (name === currentProject) {
        useEditorStore.getState().closeProject();
      }
      refresh();
    },
    [refresh, currentProject],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCreate();
      if (e.key === 'Escape' && currentProject) onClose();
    },
    [handleCreate, currentProject, onClose],
  );

  return (
    <div className="project-picker-overlay" onClick={currentProject ? onClose : undefined}>
      <div className="project-picker" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="project-picker-header">
          <svg className="project-picker-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <div className="project-picker-title">Projects</div>
          {currentProject && (
            <button className="project-picker-close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Create new */}
        <div className="project-picker-create">
          <input
            className="project-picker-input"
            type="text"
            placeholder="New project name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="project-picker-create-btn"
            onClick={handleCreate}
            disabled={!newName.trim()}
            title="Create project"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        {projects.length > 0 && <div className="project-picker-divider" />}

        {/* List */}
        <div className="project-picker-list">
          {loading ? (
            <div className="project-picker-empty">
              <div className="project-picker-spinner" />
            </div>
          ) : projects.length === 0 ? (
            <div className="project-picker-empty">
              <span className="project-picker-empty-text">No projects yet</span>
              <span className="project-picker-empty-hint">Type a name above to create your first project</span>
            </div>
          ) : (
            projects.map((name) => (
              <div
                key={name}
                className={`project-picker-item${name === currentProject ? ' active' : ''}`}
              >
                {deletingName === name ? (
                  <div className="project-picker-item-confirm">
                    <span className="project-picker-item-confirm-text">Delete "{name}"?</span>
                    <button
                      className="project-picker-item-confirm-yes"
                      onClick={() => confirmDelete(name)}
                    >
                      Delete
                    </button>
                    <button
                      className="project-picker-item-confirm-no"
                      onClick={() => setDeletingName(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="project-picker-item-name"
                      onClick={() => handleOpen(name)}
                    >
                      <svg className="project-picker-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4a1.5 1.5 0 011.5-1.5h3.25l1.5 1.5H12.5A1.5 1.5 0 0114 5.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                      <span>{name}</span>
                      {name === currentProject && (
                        <span className="project-picker-item-badge">Active</span>
                      )}
                    </button>
                    <button
                      className="project-picker-item-delete"
                      onClick={() => handleDelete(name)}
                      title="Delete project"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 4h8M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M5.5 6.5v4M8.5 6.5v4M4 4l.5 7.5a1 1 0 001 .5h3a1 1 0 001-.5L10 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
