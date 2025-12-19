import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';

/**
 * Schema for signing an agreement.
 */
const SignAgreementSchema = z.object({
  signaturePngBase64: z.string().optional(),
  signatureStrokesJson: z.record(z.any()).optional(),
  agreed: z.boolean().refine(val => val === true, {
    message: 'Agreement must be acknowledged',
  }),
});

type SignAgreementInput = z.infer<typeof SignAgreementSchema>;

interface AgreementRow {
  id: string;
  version: string;
  title: string;
  body_text: string;
  active: boolean;
  created_at: Date;
}

interface SessionRow {
  id: string;
  member_id: string;
  member_name: string;
  membership_number: string | null;
  checkin_type: string | null;
  agreement_signed: boolean;
}

/**
 * Agreement routes for managing club agreements and signatures.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function agreementRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/agreements/active - Get the active agreement
   * 
   * Returns the active agreement metadata (version/title) and body_text.
   */
  fastify.get('/v1/agreements/active', async (_request, reply: FastifyReply) => {
    try {
      const result = await query<AgreementRow>(
        `SELECT id, version, title, body_text, active, created_at
         FROM agreements
         WHERE active = true
         ORDER BY created_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: 'No active agreement found',
        });
      }

      const agreement = result.rows[0]!;

      return reply.send({
        id: agreement.id,
        version: agreement.version,
        title: agreement.title,
        bodyText: agreement.body_text,
        active: agreement.active,
        createdAt: agreement.created_at,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch active agreement');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/checkins/:checkinId/agreement-sign - Sign the agreement for a check-in
   * 
   * Stores the signature and marks the check-in as "agreement signed".
   * Only allowed for initial check-in and renewal check-ins, rejected for upgrades.
   * 
   * This endpoint is accessible without authentication for customer kiosks.
   * Security is provided by validating the session exists and hasn't been signed.
   */
  fastify.post('/v1/checkins/:checkinId/agreement-sign', async (
    request: FastifyRequest<{ 
      Params: { checkinId: string };
      Body: SignAgreementInput;
    }>,
    reply: FastifyReply
  ) => {

    let body: SignAgreementInput;
    
    try {
      body = SignAgreementSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // 1. Get the session and verify it exists
        const sessionResult = await client.query<SessionRow>(
          `SELECT id, member_id, member_name, membership_number, checkin_type, agreement_signed
           FROM sessions
           WHERE id = $1
           FOR UPDATE`,
          [request.params.checkinId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Check-in not found' };
        }

        const session = sessionResult.rows[0]!;

        // 2. Verify this is an initial check-in or renewal (not upgrade)
        if (session.checkin_type === 'UPGRADE') {
          throw { 
            statusCode: 400, 
            message: 'Agreement signing is not required for upgrades' 
          };
        }

        // 3. Check if already signed
        if (session.agreement_signed) {
          throw { 
            statusCode: 400, 
            message: 'Agreement already signed for this check-in' 
          };
        }

        // 4. Get the active agreement
        const agreementResult = await client.query<AgreementRow>(
          `SELECT id, version, title, body_text
           FROM agreements
           WHERE active = true
           ORDER BY created_at DESC
           LIMIT 1`
        );

        if (agreementResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active agreement found' };
        }

        const agreement = agreementResult.rows[0]!;

        // 5. Store the signature
        const signatureResult = await client.query<{ id: string }>(
          `INSERT INTO agreement_signatures (
            agreement_id, checkin_id, customer_name, membership_number,
            signature_png_base64, signature_strokes_json,
            agreement_text_snapshot, agreement_version,
            device_id, device_type, user_agent, ip_address
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id`,
          [
            agreement.id,
            session.id,
            session.member_name,
            session.membership_number,
            body.signaturePngBase64 || null,
            body.signatureStrokesJson ? JSON.stringify(body.signatureStrokesJson) : null,
            agreement.body_text,
            agreement.version,
            request.headers['x-device-id'] || null,
            request.headers['x-device-type'] || 'customer-kiosk',
            request.headers['user-agent'] || null,
            request.ip || null,
          ]
        );

        // 6. Mark session as agreement signed
        await client.query(
          `UPDATE sessions 
           SET agreement_signed = true, updated_at = NOW()
           WHERE id = $1`,
          [session.id]
        );

        return {
          signatureId: signatureResult.rows[0]!.id,
          agreementVersion: agreement.version,
          signedAt: new Date(),
        };
      });

      return reply.status(200).send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to sign agreement');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

