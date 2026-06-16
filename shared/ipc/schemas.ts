import { z } from 'zod';

/** Profile / correlation ids from local profiles or UUIDs */
export const profileIdSchema = z.string().min(1).max(256);

export const vaultSearchArgsSchema = z.tuple([
  profileIdSchema,
  z.string().max(2048),
]);

export type VaultSearchArgs = z.infer<typeof vaultSearchArgsSchema>;
