import { useState, useEffect } from 'react';
import type { StaffSession } from './LockScreen';
import { ReAuthModal } from './ReAuthModal';

const API_BASE = '/api';

interface StaffMember {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
}

interface PasskeyCredential {
  id: string;
  deviceId: string;
  credentialId: string;
  signCount: number;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

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

  useEffect(() => {
    loadStaff();
  }, [search, roleFilter, activeFilter]);

  const loadStaff = async () => {
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
  };

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

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
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
          <button
            onClick={() => setShowCreateModal(true)}
            className="cs-liquid-button"
          >
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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 14L11.1 11.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
                        className={member.active ? 'cs-liquid-button cs-liquid-button--danger' : 'cs-liquid-button'}
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

function CreateStaffModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { name: string; role: 'STAFF' | 'ADMIN'; pin: string; active: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'STAFF' | 'ADMIN'>('STAFF');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pin.match(/^\d{6}$/)) {
      return;
    }
    onCreate({ name: name.trim(), role, pin, active });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '500px',
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Create Staff Member</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              Role *
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'STAFF' | 'ADMIN')}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            >
              <option value="STAFF">STAFF</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              PIN (6 digits) *
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              pattern="\d{6}"
              inputMode="numeric"
              maxLength={6}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="cs-liquid-button cs-liquid-button--secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cs-liquid-button"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StaffDetailModal({
  staff,
  passkeys,
  onClose,
  onRevokePasskey,
  onPinReset,
  sessionToken,
}: {
  staff: StaffMember;
  passkeys: PasskeyCredential[];
  onClose: () => void;
  onRevokePasskey: (credentialId: string) => void;
  onPinReset: () => void;
  sessionToken: string;
}) {
  const [activeTab, setActiveTab] = useState<'details' | 'passkeys' | 'documents'>('details');
  const [documents, setDocuments] = useState<
    Array<{
      id: string;
      docType: string;
      filename: string;
      mimeType: string;
      uploadedAt: string;
      notes: string | null;
    }>
  >([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    if (activeTab === 'documents') {
      fetchDocuments();
    }
  }, [activeTab, staff.id]);

  const fetchDocuments = async () => {
    setLoadingDocs(true);
    try {
      const response = await fetch(`${API_BASE}/v1/admin/employees/${staff.id}/documents`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoadingDocs(false);
    }
  };

  const handleUpload = async (file: File, docType: string, notes?: string) => {
    try {
      // Convert file to base64 for POC
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const response = await fetch(`${API_BASE}/v1/admin/employees/${staff.id}/documents`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            docType,
            filename: file.name,
            mimeType: file.type,
            fileData: base64,
            notes,
          }),
        });
        if (response.ok) {
          await fetchDocuments();
          setShowUploadModal(false);
        } else {
          alert('Failed to upload document');
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert('Failed to upload document');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        overflow: 'auto',
        padding: '2rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.5rem' }}>{staff.name}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1.5rem',
            borderBottom: '1px solid #374151',
          }}
        >
          <button
            onClick={() => setActiveTab('details')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'details' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'details' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('passkeys')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'passkeys' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'passkeys' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Passkeys
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'documents' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'documents' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Documents
          </button>
        </div>

        {activeTab === 'details' && (
          <>
            <div style={{ marginBottom: '2rem' }}>
              <p>
                <strong>Role:</strong> {staff.role}
              </p>
              <p>
                <strong>Status:</strong> {staff.active ? 'Active' : 'Inactive'}
              </p>
              <p>
                <strong>Created:</strong> {new Date(staff.createdAt).toLocaleString()}
              </p>
              <p>
                <strong>Last Login:</strong>{' '}
                {staff.lastLogin ? new Date(staff.lastLogin).toLocaleString() : 'Never'}
              </p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
            <button
              onClick={onPinReset}
              className="cs-liquid-button cs-liquid-button--secondary"
              style={{ marginRight: '1rem' }}
            >
              Reset PIN
            </button>
            </div>
          </>
        )}

        {activeTab === 'passkeys' && (
          <>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Passkeys</h3>
            {passkeys.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No passkeys registered</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Credential ID</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Device</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Created</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Last Used</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {passkeys.map((pk) => (
                    <tr key={pk.id} style={{ borderBottom: '1px solid #374151' }}>
                      <td
                        style={{
                          padding: '0.75rem',
                          fontFamily: 'monospace',
                          fontSize: '0.875rem',
                        }}
                      >
                        {pk.credentialId.slice(0, 16)}...
                      </td>
                      <td style={{ padding: '0.75rem' }}>{pk.deviceId}</td>
                      <td style={{ padding: '0.75rem', color: '#9ca3af' }}>
                        {new Date(pk.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '0.75rem', color: '#9ca3af' }}>
                        {pk.lastUsedAt ? new Date(pk.lastUsedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span
                          style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '4px',
                            fontSize: '0.875rem',
                            background: pk.isActive ? '#10b981' : '#ef4444',
                            color: '#f9fafb',
                          }}
                        >
                          {pk.isActive ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {pk.isActive && (
                          <button
                            onClick={() => onRevokePasskey(pk.credentialId)}
                            className="cs-liquid-button cs-liquid-button--danger"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'documents' && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ fontSize: '1.25rem' }}>Documents</h3>
              <button
                onClick={() => setShowUploadModal(true)}
                className="cs-liquid-button"
              >
                Upload Document
              </button>
            </div>
            {loadingDocs ? (
              <p style={{ color: '#9ca3af' }}>Loading documents...</p>
            ) : documents.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No documents uploaded</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Filename</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Uploaded</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} style={{ borderBottom: '1px solid #374151' }}>
                      <td style={{ padding: '0.75rem' }}>{doc.docType}</td>
                      <td style={{ padding: '0.75rem' }}>{doc.filename}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                        {new Date(doc.uploadedAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <a
                          href={`${API_BASE}/v1/admin/documents/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '0.5rem 1rem',
                            background: '#374151',
                            borderRadius: '6px',
                            color: '#f9fafb',
                            textDecoration: 'none',
                            fontSize: '0.875rem',
                          }}
                        >
                          Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Upload Document Modal */}
      {showUploadModal && (
        <UploadDocumentModal onClose={() => setShowUploadModal(false)} onUpload={handleUpload} />
      )}
    </div>
  );
}

function UploadDocumentModal({
  onClose,
  onUpload,
}: {
  onClose: () => void;
  onUpload: (file: File, docType: string, notes?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('OTHER');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    if (!file) {
      alert('Please select a file');
      return;
    }
    setUploading(true);
    try {
      await onUpload(file, docType, notes || undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          border: '1px solid #374151',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
          Upload Document
        </h2>
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Document Type
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
              fontSize: '1rem',
            }}
          >
            <option value="ID">ID</option>
            <option value="W4">W4</option>
            <option value="I9">I9</option>
            <option value="OFFER_LETTER">Offer Letter</option>
            <option value="NDA">NDA</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            File
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
              fontSize: '1rem',
            }}
          />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
              fontSize: '1rem',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={uploading}
            className="cs-liquid-button cs-liquid-button--secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={uploading || !file}
            className="cs-liquid-button"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PinResetModal({
  staffId,
  staffName,
  onClose,
  onReset,
}: {
  staffId: string;
  staffName: string;
  onClose: () => void;
  onReset: (staffId: string, newPin: string) => void;
}) {
  const [newPin, setNewPin] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.match(/^\d{6}$/)) {
      onReset(staffId, newPin);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '400px',
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1rem' }}>Reset PIN for {staffName}</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              New PIN (6 digits) *
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              pattern="\d{6}"
              inputMode="numeric"
              maxLength={6}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="cs-liquid-button cs-liquid-button--secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cs-liquid-button"
            >
              Reset PIN
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
