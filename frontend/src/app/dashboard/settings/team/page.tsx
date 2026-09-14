"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Mail, Shield, Trash2, CheckCircle2 } from "lucide-react";
import { api, useAuth } from "../../../../lib/auth";

interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  mfa_enabled: boolean;
  joined_at: string;
}

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Analyst");
  const [inviting, setInviting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    try {
      const data = await api<{ members: TeamMember[] }>("/v1/auth/team");
      setMembers(data.members || []);
    } catch {
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setSuccess(null);
    try {
      const res = await api<{ message: string }>("/v1/auth/invite", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setSuccess(res.message || `Invitation sent to ${inviteEmail}.`);
      setInviteEmail("");
      fetchTeam();
    } catch (err: any) {
      alert(`Invite failed: ${err.message}`);
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = (email: string) => {
    if (confirm(`Are you sure you want to remove ${email} from the team?`)) {
      setMembers(members.filter(m => m.email !== email));
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Team Management</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Manage who has access to your CTRL merchant dashboard and their permissions.
        </p>
      </div>

      {success && (
        <div style={{
          padding: "12px 16px", borderRadius: 8,
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
          color: "var(--emerald)", fontSize: 13, display: "flex", alignItems: "center", gap: 8
        }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Invite Form */}
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Invite Team Member</h2>
        <form onSubmit={handleInvite} style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
          <div style={{ flex: 2 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>Email Address</label>
            <input
              type="email"
              className="input"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>Role</label>
            <select
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="Manager">Manager</option>
              <option value="Analyst">Analyst</option>
              <option value="Viewer">Viewer</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={inviting} style={{ height: 40, flexShrink: 0 }}>
            {inviting ? "Sending..." : <><Mail size={16} /> Send Invite</>}
          </button>
        </form>
      </div>

      {/* Members List */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>MFA Status</th>
                <th>Joined</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "var(--bg-hover)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 600, color: "var(--text-secondary)"
                      }}>
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{member.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${member.role === 'Owner' ? 'badge-violet' : 'badge-gray'}`}>
                      <Shield size={10} /> {member.role}
                    </span>
                  </td>
                  <td>
                    {member.mfa_enabled ? (
                      <span className="badge badge-green">Enabled</span>
                    ) : (
                      <span className="badge badge-amber">Disabled</span>
                    )}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(member.joined_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleRemove(member.email)}
                      disabled={member.role === 'Owner'}
                      style={{ padding: "6px 10px", fontSize: 12, color: member.role === 'Owner' ? "var(--text-muted)" : "var(--rose)" }}
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && user && (
                <tr>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "var(--bg-hover)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 600, color: "var(--text-secondary)"
                      }}>
                        {user.name ? user.name.charAt(0) : user.email.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{user.name || user.email.split('@')[0]} (You)</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-violet">
                      <Shield size={10} /> {user.role || 'Owner'}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-green">Active</span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    Just now
                  </td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>
                    Current User
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
