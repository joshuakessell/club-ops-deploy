type AssignedLabelInput = {
  assignedResourceType: 'room' | 'locker' | null;
  proposedRentalType: string | null;
  customerSelectedType: string | null;
};

export function deriveAssignedLabel(input: AssignedLabelInput): string {
  const { assignedResourceType, proposedRentalType, customerSelectedType } = input;

  if (assignedResourceType) {
    return assignedResourceType === 'room' ? 'Room' : 'Locker';
  }

  const rentalType = proposedRentalType || customerSelectedType;
  if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') return 'Locker';
  if (rentalType === 'STANDARD' || rentalType === 'DOUBLE' || rentalType === 'SPECIAL') {
    return 'Room';
  }

  return 'Resource';
}
