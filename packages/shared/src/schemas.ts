import { z } from 'zod';
import { RoomStatus, RoomType } from './enums';

/**
 * Zod schema for RoomStatus enum validation.
 */
export const RoomStatusSchema = z.nativeEnum(RoomStatus);

/**
 * Zod schema for RoomType enum validation.
 */
export const RoomTypeSchema = z.nativeEnum(RoomType);

/**
 * Zod schema for Room entity.
 */
export const RoomSchema = z.object({
  id: z.string().uuid(),
  number: z.string().min(1),
  type: RoomTypeSchema,
  status: RoomStatusSchema,
  floor: z.number().int().positive(),
  lastStatusChange: z.coerce.date(),
  assignedToCustomerId: z.string().uuid().optional(),
  overrideFlag: z.boolean(),
});

/**
 * Zod schema for creating/updating room status.
 */
export const RoomStatusUpdateSchema = z.object({
  roomId: z.string().uuid(),
  newStatus: RoomStatusSchema,
  override: z.boolean().default(false),
  reason: z.string().optional(),
});

/**
 * Zod schema for inventory summary.
 */
export const InventorySummarySchema = z.object({
  clean: z.number().int().nonnegative(),
  cleaning: z.number().int().nonnegative(),
  dirty: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * Zod schema for batch room status update (cleaning station).
 */
export const BatchStatusUpdateSchema = z.object({
  roomIds: z.array(z.string().uuid()).min(1),
  newStatus: RoomStatusSchema,
  override: z.boolean().default(false),
  reason: z.string().optional(),
});

// Type exports derived from schemas
export type RoomInput = z.infer<typeof RoomSchema>;
export type RoomStatusUpdateInput = z.infer<typeof RoomStatusUpdateSchema>;
export type InventorySummaryInput = z.infer<typeof InventorySummarySchema>;
export type BatchStatusUpdateInput = z.infer<typeof BatchStatusUpdateSchema>;

