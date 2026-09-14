"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../../../../lib/auth";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  environment: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const data = await api<{ keys?: ApiKey[]; api_keys?: ApiKey[] }>("/v1/api-keys");
      setKeys(data.api_keys || data.keys || []);
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api<{ raw_key: string }>("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newName, environment: "live" }),
      });
      setNewKey(res.raw_key);
      setNewName("");
      fetchKeys();
    } catch (err: any) {
      alert(`Failed to create API key: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to revoke this API key? Any applications using it will lose access immediately.")) {
      try {
        await api(`/v1/api-keys/${id}`, { method: "DELETE" });
        fetchKeys();
      } catch (err: any) {
        alert(`Failed to revoke key: ${err.message}`);
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 800 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>API Keys</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Manage API keys for authenticating with the CTRL Control Plane programmatically.
        </p>
      </div>

      {/* New Key Alert */}
      {newKey && (
        <div style={{
          padding: "20px", borderRadius: 10,
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--emerald)", fontWeight: 600, marginBottom: 12 }}>
            <CheckCircle2 size={18} /> API Key Created Successfully
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
            Please copy this key now. For your security, you will not be able to see it again.
          </p>
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: 8,
            border: "1px solid rgba(16,185,129,0.2)",
          }}>
            <code style={{ flex: 1, color: "var(--text-primary)", fontFamily: "monospace", fontSize: 14 }}>{newKey}</code>
            <button className="btn btn-primary" onClick={() => copyToClipboard(newKey)} style={{ padding: "6px 12px", fontSize: 12 }}>
              <Copy size={14} /> Copy
            </button>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setNewKey(null)} style={{ fontSize: 12 }}>Close</button>
          </div>
        </div>
      )}

      {/* Create Key Form */}
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Create New Key</h2>
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>Key Name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Production Backend Service"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating} style={{ height: 40 }}>
            {creating ? "Creating..." : <><Plus size={16} /> Create Key</>}
          </button>
        </form>
      </div>

      {/* Keys List */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last Used</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td style={{ fontWeight: 500 }}>{key.name}</td>
                  <td><code style={{ background: "var(--bg-base)", padding: "4px 8px", borderRadius: 6, fontSize: 12, color: "var(--text-secondary)" }}>{key.key_prefix || (key as any).prefix}</code></td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{new Date(key.created_at).toLocaleDateString()}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(key.id)}
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      title="Revoke Key"
                    >
                      <Trash2 size={14} /> Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                    No API keys found. Create one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color="var(--amber)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--amber)" }}>Security Best Practices:</strong> Do not share your API keys in publicly accessible areas such as GitHub, client-side code, or public forums. If a key is compromised, revoke it immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
