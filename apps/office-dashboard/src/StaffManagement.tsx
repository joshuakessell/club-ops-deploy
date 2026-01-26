import { useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '@club-ops/shared';
import type { StaffSession } from './LockScreen';
import { ReAuthModal } from './ReAuthModal';
import { CreateStaffModal } from './staff/CreateStaffModal';
import { PinResetModal } from './staff/PinResetModal';
import { StaffDetailModal } from './staff/StaffDetailModal';
import type { PasskeyCredential, StaffMember } from './staff/types';

const API_BASE = getApiUrl('/api');

interface StaffManagementProps {
  session: StaffSession;
}

export function StaffManagement({ session }: StaffManagementProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [showPinResetModal, setShowPinResetModal] = useState(false);
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [, setPendingPinReset] = useState<{ staffId: string; newPin: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadStaff = useCallback(async () => {
    if (!session.sessionToken) return;

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (activeFilter) params.set('active', activeFilter);

      const response = await fetch(`${API_BASE}/v1/admin/staff?${params}`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStaff(data.staff || []);
      }
    } catch (error) {
      console.error('Failed to load staff:', error);
      showToast('Failed to load staff', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, roleFilter, search, session.sessionToken, showToast]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const loadPasskeys = async (staffId: string) => {
    if (!session.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/auth/webauthn/credentials/${staffId}`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPasskeys(data.credentials || []);
      }
    } catch (error) {
      console.error('Failed to load passkeys:', error);
      showToast('Failed to load passkeys', 'error');
    }
  };


  const handleCreateStaff = async (formData: {
    name: string;
    role: 'STAFF' | 'ADMIN';
    pin: string;
    active: boolean;
  }) => {
    if (!session.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/admin/staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        showToast('Staff created successfully', 'success');
        setShowCreateModal(false);
        loadStaff();
      } else {
        const error = await response.json();
        showToast(error.error || 'Failed to create staff', 'error');
      }
    } catch {
      showToast('Failed to create staff', 'error');
    }
  };

  const handleToggleActive = async (staffId: string, currentActive: boolean) => {
    if (!session.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/admin/staff/${staffId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ active: !currentActive }),
      });

      if (response.ok) {
        showToast(`Staff ${!currentActive ? 'activated' : 'deactivated'}`, 'success');
        loadStaff();
      } else {
        const error = await response.json();
        showToast(error.error || 'Failed to update staff', 'error');
      }
    } catch {
      showToast('Failed to update staff', 'error');
    }
  };

  const handleRevokePasskey = async (credentialId: string) => {
    if (!session.sessionToken) return;

    if (!confirm('Are you sure you want to revoke this passkey?')) return;

    // Request re-auth before proceeding
    setPendingAction(() => async () => {
      await performRevokePasskey(credentialId);
    });
    setShowReAuthModal(true);
  };

  const performRevokePasskey = async (credentialId: string) => {
    if (!session.sessionToken) return;

    try {
      const response = await fetch(
        `${API_BASE}/v1/auth/webauthn/credentials/${credentialId}/revoke`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }
      );

      if (response.ok) {
        showToast('Passkey revoked', 'success');
        if (selectedStaff) {
          loadPasskeys(selectedStaff.id);
        }
      } else {
        const error = await response.json();
        if (error.code === 'REAUTH_REQUIRED' || error.code === 'REAUTH_EXPIRED') {
          showToast('Re-authentication required. Please try again.', 'error');
        } else {
          showToast(error.error || 'Failed to revoke passkey', 'error');
        }
      }
    } catch {
      showToast('Failed to revoke passkey', 'error');
    }
  };

  const handlePinReset = async (staffId: string, newPin: string) => {
    if (!session.sessionToken) return;

    // Store the PIN reset data and request re-auth
    setPendingPinReset({ staffId, newPin });
    setPendingAction(() => async () => {
      // Use the parameters directly instead of captured state to avoid stale closures
      const success = await performPinReset(staffId, newPin);
      if (success) {
        // Only clear state on successful completion
        setPendingPinReset(null);
      }
      // On failure (including re-auth errors), keep the state so user can retry
    });
    setShowReAuthModal(true);
  };

  const performPinReset = async (staffId: string, newPin: string): Promise<boolean> => {
    if (!session.sessionToken) return false;

    try {
      const response = await fetch(`${API_BASE}/v1/admin/staff/${staffId}/pin-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ newPin }),
      });

      if (response.ok) {
        showToast('PIN reset successfully', 'success');
        setShowPinResetModal(false);
        return true;
      } else {
        const error = await response.json();
        if (error.code === 'REAUTH_REQUIRED' || error.code === 'REAUTH_EXPIRED') {
          showToast('Re-authentication required. Please try again.', 'error');
          // Don't clear state - allow retry after re-auth
          setShowReAuthModal(true);
        } else {
          showToast(error.error || 'Failed to reset PIN', 'error');
        }
        return false;
      }
    } catch {
      showToast('Failed to reset PIN', 'error');
      return false;
    }
  };

  const openStaffDetail = (staffMember: StaffMember) => {
    setSelectedStaff(staffMember);
    setShowPasskeyModal(true);
    loadPasskeys(staffMember.id);
  };

  return (
    <div
      className="staff-management"
      style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}
    >
      <div
        className="staff-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Staff Management</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={() => (window.location.href = '/admin')}
            className="cs-liquid-button cs-liquid-button--secondary"
          >
            ← Back to Admin
          </button>
          <button onClick={() => setShowCreateModal(true)} className="cs-liquid-button">
            + Create Staff
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="staff-filters"
        style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}
      >
        <div className="cs-liquid-search" style={{ flex: 1, minWidth: '200px' }}>
          <input
            className="cs-liquid-input cs-liquid-search__input"
            type="text"
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="cs-liquid-search__icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 14L11.1 11.1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{
            padding: '0.75rem',
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '6px',
            color: '#f9fafb',
            fontSize: '1rem',
          }}
        >
          <option value="">All Roles</option>
          <option value="STAFF">STAFF</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          style={{
            padding: '0.75rem',
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '6px',
            color: '#f9fafb',
            fontSize: '1rem',
          }}
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Staff Table */}
      <div
        className="staff-table-container"
        style={{ background: '#1f2937', borderRadius: '8px', overflow: 'hidden' }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#111827', borderBottom: '1px solid #374151' }}>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Active</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Created</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Last Login</th>
              <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                  Loading...
                </td>
              </tr>
            ) : staff.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                  No staff members found
                </td>
              </tr>
            ) : (
              staff.map((member) => (
                <tr key={member.id} style={{ borderBottom: '1px solid #374151' }}>
                  <td style={{ padding: '1rem' }}>{member.name}</td>
                  <td style={{ padding: '1rem' }}>
                    <span
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        background: member.role === 'ADMIN' ? '#7c3aed' : '#374151',
                        color: '#f9fafb',
                      }}
                    >
                      {member.role}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        background: member.active ? '#10b981' : '#ef4444',
                        color: '#f9fafb',
                      }}
                    >
                      {member.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: '#9ca3af' }}>
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '1rem', color: '#9ca3af' }}>
                    {member.lastLogin ? new Date(member.lastLogin).toLocaleDateString() : 'Never'}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => openStaffDetail(member)}
                        className="cs-liquid-button cs-liquid-button--secondary"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleToggleActive(member.id, member.active)}
                        className={
                          member.active
                            ? 'cs-liquid-button cs-liquid-button--danger'
                            : 'cs-liquid-button'
                        }
                      >
                        {member.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Staff Modal */}
      {showCreateModal && (
        <CreateStaffModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateStaff} />
      )}

      {/* Staff Detail Modal */}
      {showPasskeyModal && selectedStaff && (
        <StaffDetailModal
          staff={selectedStaff}
          passkeys={passkeys}
          onClose={() => {
            setShowPasskeyModal(false);
            setSelectedStaff(null);
          }}
          onRevokePasskey={handleRevokePasskey}
          onPinReset={() => setShowPinResetModal(true)}
          sessionToken={session.sessionToken}
          apiBase={API_BASE}
        />
      )}

      {/* PIN Reset Modal */}
      {showPinResetModal && selectedStaff && (
        <PinResetModal
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          onClose={() => setShowPinResetModal(false)}
          onReset={(staffId, newPin) => {
            setShowPinResetModal(false);
            handlePinReset(staffId, newPin);
          }}
        />
      )}

      {/* Re-auth Modal */}
      {showReAuthModal && session.sessionToken && (
        <ReAuthModal
          sessionToken={session.sessionToken}
          onSuccess={() => {
            setShowReAuthModal(false);
            if (pendingAction) {
              pendingAction();
              setPendingAction(null);
            }
          }}
          onCancel={() => {
            setShowReAuthModal(false);
            setPendingAction(null);
            setPendingPinReset(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            padding: '1rem 1.5rem',
            background: toast.type === 'success' ? '#10b981' : '#ef4444',
            color: '#f9fafb',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
