import { useState } from 'react';
import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  currentSessionId: string | null;
  setIsSubmitting: (value: boolean) => void;
};

export function useNotesState({ session, lane, currentSessionId, setIsSubmitting }: Params) {
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  const handleAddNote = async () => {
    if (!session?.sessionToken || !currentSessionId || !newNoteText.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/add-note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ note: newNoteText.trim() }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to add note');
      }

      setShowAddNoteModal(false);
      setNewNoteText('');
    } catch (error) {
      console.error('Failed to add note:', error);
      alert(error instanceof Error ? error.message : 'Failed to add note');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    showAddNoteModal,
    setShowAddNoteModal,
    newNoteText,
    setNewNoteText,
    handleAddNote,
  };
}
