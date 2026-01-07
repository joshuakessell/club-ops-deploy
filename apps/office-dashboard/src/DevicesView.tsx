import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';

const API_BASE = '/api';

interface Device {
  deviceId: string;
  displayName: string;
  enabled: boolean;
}

interface DevicesViewProps {
  session: StaffSession;
}

export function DevicesView({ session }: DevicesViewProps) {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/admin/devices`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setDevices(data);
      }
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const enabledCount = devices.filter((d) => d.enabled).length;
  const canAddMore = enabledCount < 2;

  const handleAddDevice = async () => {
    if (!newDeviceId.trim() || !newDeviceName.trim()) {
      alert('Device ID and display name are required');
      return;
    }

    setAdding(true);
    try {
      const response = await fetch(`${API_BASE}/v1/admin/devices`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId: newDeviceId.trim(),
          displayName: newDeviceName.trim(),
        }),
      });

      if (response.ok) {
        await fetchDevices();
        setShowAddModal(false);
        setNewDeviceId('');
        setNewDeviceName('');
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to add device');
      }
    } catch (error) {
      console.error('Failed to add device:', error);
      alert('Failed to add device');
    } finally {
      setAdding(false);
    }
  };

  const handleToggleDevice = async (deviceId: string, currentEnabled: boolean) => {
    if (!currentEnabled && enabledCount >= 2) {
      alert('Maximum of 2 enabled devices allowed');
      return;
    }

    setToggling(deviceId);
    try {
      const response = await fetch(`${API_BASE}/v1/admin/devices/${deviceId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: !currentEnabled,
        }),
      });

      if (response.ok) {
        await fetchDevices();
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to update device');
      }
    } catch (error) {
      console.error('Failed to toggle device:', error);
      alert('Failed to update device');
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading devices...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Device Allowlist
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
            {enabledCount} of 2 devices enabled
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={() => setShowAddModal(true)}
            disabled={!canAddMore}
            style={{
              padding: '0.75rem 1.5rem',
              background: canAddMore ? '#10b981' : '#6b7280',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: canAddMore ? 'pointer' : 'not-allowed',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            Add Device
          </button>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#374151',
              border: 'none',
              borderRadius: '6px',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {devices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#9ca3af' }}>
          <p>No devices configured</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Add a device to allow it to sign into registers
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {devices.map((device) => (
            <div
              key={device.deviceId}
              style={{
                border: '1px solid #374151',
                borderRadius: '8px',
                padding: '1.5rem',
                background: '#1f2937',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  {device.displayName}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>ID: {device.deviceId}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: device.enabled ? '#10b981' : '#6b7280',
                    color: '#fff',
                  }}
                >
                  {device.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  onClick={() => handleToggleDevice(device.deviceId, device.enabled)}
                  disabled={toggling === device.deviceId || (!device.enabled && enabledCount >= 2)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: device.enabled ? '#ef4444' : '#10b981',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    cursor:
                      toggling === device.deviceId || (!device.enabled && enabledCount >= 2)
                        ? 'not-allowed'
                        : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  {toggling === device.deviceId ? '...' : device.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
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
          onClick={() => !adding && setShowAddModal(false)}
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
              Add Device
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
                Device ID
              </label>
              <input
                type="text"
                value={newDeviceId}
                onChange={(e) => setNewDeviceId(e.target.value)}
                placeholder="device-123"
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
                Display Name
              </label>
              <input
                type="text"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                placeholder="Register Tablet 1"
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
                onClick={() => {
                  setShowAddModal(false);
                  setNewDeviceId('');
                  setNewDeviceName('');
                }}
                disabled={adding}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#374151',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  cursor: adding ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddDevice}
                disabled={adding || !newDeviceId.trim() || !newDeviceName.trim()}
                style={{
                  padding: '0.75rem 1.5rem',
                  background:
                    adding || !newDeviceId.trim() || !newDeviceName.trim() ? '#6b7280' : '#10b981',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor:
                    adding || !newDeviceId.trim() || !newDeviceName.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  fontSize: '1rem',
                  fontWeight: 600,
                }}
              >
                {adding ? 'Adding...' : 'Add Device'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
