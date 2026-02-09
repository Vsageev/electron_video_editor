import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';

interface KeyEntry {
  name: string;
  value: string;
}

const DEFAULT_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ELEVEN_LABS_API_KEY',
];

export default function ApiKeysModal() {
  const showSettings = useEditorStore((s) => s.showSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!showSettings) return;
    window.api.getApiKeys().then((stored) => {
      const entries: KeyEntry[] = DEFAULT_KEYS.map((name) => ({
        name,
        value: stored[name] || '',
      }));
      // Add any extra keys from storage that aren't in defaults
      for (const [name, value] of Object.entries(stored)) {
        if (!DEFAULT_KEYS.includes(name)) {
          entries.push({ name, value: value as string });
        }
      }
      setKeys(entries);
      setSaved(false);
    });
  }, [showSettings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const obj: Record<string, string> = {};
    for (const k of keys) {
      const name = k.name.trim();
      if (name) obj[name] = k.value;
    }
    await window.api.setApiKeys(obj);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [keys]);

  const updateKey = (index: number, field: 'name' | 'value', val: string) => {
    setKeys((prev) => prev.map((k, i) => (i === index ? { ...k, [field]: val } : k)));
    setSaved(false);
  };

  const addKey = () => {
    setKeys((prev) => [...prev, { name: '', value: '' }]);
  };

  const removeKey = (index: number) => {
    setKeys((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };

  if (!showSettings) return null;

  return (
    <div className="export-overlay" onClick={() => setShowSettings(false)}>
      <div
        className="export-modal settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="export-modal-title">API Keys</div>
        <p className="settings-desc">
          Keys are stored locally on your machine.
        </p>

        <div className="api-keys-list">
          {keys.map((k, i) => (
            <div className="api-key-row" key={i}>
              <input
                className="property-input api-key-name"
                placeholder="KEY_NAME"
                value={k.name}
                onChange={(e) => updateKey(i, 'name', e.target.value)}
                spellCheck={false}
              />
              <input
                className="property-input api-key-value"
                type="password"
                placeholder="value"
                value={k.value}
                onChange={(e) => updateKey(i, 'value', e.target.value)}
                spellCheck={false}
              />
              <button
                className="keyframe-delete-btn"
                onClick={() => removeKey(i)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        <button className="btn-add-key" onClick={addKey}>
          + Add key
        </button>

        <div className="export-settings-actions">
          <button
            className="btn-export-cancel"
            onClick={() => setShowSettings(false)}
          >
            Close
          </button>
          <button className="btn-export" onClick={handleSave} disabled={saving}>
            {saved ? 'Saved' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
