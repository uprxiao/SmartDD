import { z } from 'zod';
/** Structural identity only. Executability still requires a trusted startup registration. */
export const agentIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
