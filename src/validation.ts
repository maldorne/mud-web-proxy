import { z } from 'zod';

export const clientMessageSchema = z
  .object({
    mud: z.string().max(64).optional(),
    host: z.string().max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    connect: z.literal(1).optional(),
    ttype: z.string().max(64).optional(),
    name: z.string().max(64).optional(),
    client: z.string().max(128).optional(),
    mccp: z.number().int().min(0).max(1).optional(),
    utf8: z.number().int().min(0).max(1).optional(),
    debug: z.number().int().min(0).max(1).optional(),
    chat: z.literal(1).optional(),
    channel: z.string().max(32).optional(),
    msg: z.string().max(4096).optional(),
    bin: z.array(z.number().int().min(0).max(255)).max(4096).optional(),
    msdp: z
      .object({
        key: z.string().max(128),
        val: z.union([z.string().max(1024), z.array(z.string().max(1024))]),
      })
      .optional(),
    gmcp: z.string().max(4096).optional(),
  })
  .passthrough();

export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>;
