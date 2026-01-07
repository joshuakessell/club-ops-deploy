import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import { generateAgreementPdf } from '../utils/pdf-generator.js';

/**
 * Schema for signing an agreement.
 */
const SignAgreementSchema = z.object({
  signaturePngBase64: z.string().optional(),
  signatureStrokesJson: z.record(z.any()).optional(),
  agreed: z.boolean().refine((val) => val === true, {
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
  customer_id: string;
  checkin_type: string | null;
  room_id: string | null;
  locker_id: string | null;
  check_in_time: Date;
  checkout_at: Date | null;
  visit_id: string | null;
}

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
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
  fastify.post(
    '/v1/checkins/:checkinId/agreement-sign',
    async (
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
            `SELECT id, customer_id, checkin_type, room_id, locker_id, check_in_time, checkout_at, visit_id
           FROM sessions
           WHERE id = $1
           FOR UPDATE`,
            [request.params.checkinId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Check-in not found' };
          }

          const session = sessionResult.rows[0]!;

          // 2. Get customer info
          const customerResult = await client.query<CustomerRow>(
            `SELECT id, name, membership_number FROM customers WHERE id = $1`,
            [session.customer_id]
          );

          if (customerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const customer = customerResult.rows[0]!;

          // 3. Verify this is an initial check-in or renewal (not upgrade)
          if (session.checkin_type === 'UPGRADE') {
            throw {
              statusCode: 400,
              message: 'Agreement signing is not required for upgrades',
            };
          }

          // 4. Get the checkin_block_id from the session and check if already signed
          const blockResult = session.visit_id
            ? await client.query<{ id: string; agreement_signed: boolean }>(
                `SELECT cb.id, cb.agreement_signed
               FROM checkin_blocks cb
               WHERE cb.visit_id = $1
               ORDER BY cb.created_at DESC
               LIMIT 1`,
                [session.visit_id]
              )
            : { rows: [] as Array<{ id: string; agreement_signed: boolean }> };

          if (blockResult.rows.length > 0 && blockResult.rows[0]!.agreement_signed) {
            throw {
              statusCode: 400,
              message: 'Agreement already signed for this check-in',
            };
          }

          // If there is no check-in block yet (legacy /v1/sessions flow), create visit + checkin_block now.
          // This keeps agreement signing self-contained and matches the canonical schema contract.
          let checkinBlockId = blockResult.rows[0]?.id ?? null;
          if (!checkinBlockId) {
            // Determine visit_id (reuse existing active visit if present, else create one)
            let visitId = session.visit_id;
            if (!visitId) {
              const activeVisitResult = await client.query<{ id: string }>(
                `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
                [session.customer_id]
              );
              if (activeVisitResult.rows.length > 0) {
                visitId = activeVisitResult.rows[0]!.id;
              } else {
                const createdVisitResult = await client.query<{ id: string }>(
                  `INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`,
                  [session.customer_id, session.check_in_time]
                );
                visitId = createdVisitResult.rows[0]!.id;
              }

              // Persist visit_id on the session for traceability
              await client.query(
                `UPDATE sessions SET visit_id = $1, updated_at = NOW() WHERE id = $2`,
                [visitId, session.id]
              );
            }

            // Determine rental_type from the session assignment
            let rentalType: string = 'LOCKER';
            if (session.room_id) {
              const roomTypeResult = await client.query<{ type: string }>(
                `SELECT type FROM rooms WHERE id = $1`,
                [session.room_id]
              );
              rentalType = roomTypeResult.rows[0]?.type ?? 'STANDARD';
            } else if (session.locker_id) {
              rentalType = 'LOCKER';
            }

            const startsAt = session.check_in_time;
            const endsAt = session.checkout_at ?? new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
            const blockType = (session.checkin_type ?? 'INITIAL') as
              | 'INITIAL'
              | 'RENEWAL'
              | 'UPGRADE';

            const createdBlock = await client.query<{ id: string }>(
              `INSERT INTO checkin_blocks
             (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
              [
                visitId,
                blockType,
                startsAt,
                endsAt,
                rentalType,
                session.room_id,
                session.locker_id,
                null,
              ]
            );
            checkinBlockId = createdBlock.rows[0]!.id;
          }

          // 5. Get the active agreement
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

          // 6. Store the signature
          const signatureBase64 = body.signaturePngBase64
            ? body.signaturePngBase64.startsWith('data:')
              ? body.signaturePngBase64.split(',')[1]
              : body.signaturePngBase64
            : null;

          const signedAt = new Date();

          // Generate + store agreement PDF bytes on the check-in block
          let pdfBuffer: Buffer | null = null;
          if (signatureBase64) {
            try {
              pdfBuffer = await generateAgreementPdf({
                agreementTitle: agreement.title,
                agreementVersion: agreement.version,
                agreementText: agreement.body_text,
                customerName: customer.name,
                membershipNumber: customer.membership_number || undefined,
                signedAt,
                signatureImageBase64: signatureBase64,
              });
            } catch (e) {
              fastify.log.warn(
                { err: e },
                'Failed to generate agreement PDF from provided signature'
              );
              throw {
                statusCode: 400,
                message: 'Invalid signature image (expected PNG data URL or base64)',
              };
            }
          }

          if (pdfBuffer) {
            await client.query(
              `UPDATE checkin_blocks
             SET agreement_signed = true,
                 agreement_pdf = $1,
                 agreement_signed_at = $2,
                 updated_at = NOW()
             WHERE id = $3`,
              [pdfBuffer, signedAt, checkinBlockId]
            );
          } else {
            // Still mark as signed if the caller acknowledged; signature payload may be strokes-only for legacy clients.
            await client.query(
              `UPDATE checkin_blocks
             SET agreement_signed = true,
                 agreement_signed_at = $1,
                 updated_at = NOW()
             WHERE id = $2`,
              [signedAt, checkinBlockId]
            );
          }

          const signatureResult = await client.query<{ id: string }>(
            `INSERT INTO agreement_signatures (
            agreement_id, checkin_id, checkin_block_id, customer_name, membership_number,
            signature_png_base64, signature_strokes_json,
            agreement_text_snapshot, agreement_version,
            device_id, device_type, user_agent, ip_address
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
            [
              agreement.id,
              session.id,
              checkinBlockId,
              customer.name,
              customer.membership_number,
              signatureBase64,
              body.signatureStrokesJson ? JSON.stringify(body.signatureStrokesJson) : null,
              agreement.body_text,
              agreement.version,
              request.headers['x-device-id'] || null,
              request.headers['x-device-type'] || 'customer-kiosk',
              request.headers['user-agent'] || null,
              request.ip || null,
            ]
          );

          // Mark the session as agreement signed (used by legacy session flows)
          await client.query(
            `UPDATE sessions
           SET agreement_signed = true, updated_at = NOW()
           WHERE id = $1`,
            [session.id]
          );

          return {
            signatureId: signatureResult.rows[0]!.id,
            agreementVersion: agreement.version,
            signedAt,
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
    }
  );
}
