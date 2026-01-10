import { query, initializeDatabase, closeDatabase } from './index.js';
import { RoomStatus, RoomType } from '@club-ops/shared';
import { LOCKER_NUMBERS, ROOMS } from '@club-ops/shared';
import { hashQrToken, hashPin } from '../auth/utils.js';

interface RoomSeed {
  number: string;
  type: RoomType;
  floor: number;
  tagCode: string;
}

interface LockerSeed {
  number: string; // 3-digit "001".."108"
  tagCode: string;
}

/**
 * Seed data for development and testing.
 *
 * IMPORTANT (facility inventory contract):
 * - Lockers: 001..108
 * - Rooms: existing rooms only (nominal 200..262 minus non-existent odd 247..261)
 *
 * This seed enforces inventory presence and removes any invalid legacy rooms/lockers.
 */
const seedRooms: RoomSeed[] = ROOMS.map((r) => {
  const type: RoomType =
    r.kind === 'DELUXE' ? RoomType.DOUBLE : r.kind === 'SPECIAL' ? RoomType.SPECIAL : RoomType.STANDARD;
  return {
    number: String(r.number),
    type,
    floor: Math.floor(r.number / 100),
    tagCode: `ROOM-${r.number}`,
  };
});

const seedLockers: LockerSeed[] = LOCKER_NUMBERS.map((n) => ({
  number: n,
  tagCode: `LOCKER-${n}`,
}));

async function seed() {
  try {
    console.log('Initializing database connection...');
    await initializeDatabase();

    console.log('Starting seed process...');

    // Enforce facility inventory contract (delete any invalid legacy rooms)
    const desiredRoomNumbers = seedRooms.map((r) => r.number);
    const deletedRooms = await query<{ count: string }>(
      `WITH del AS (
         DELETE FROM rooms
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`,
      [desiredRoomNumbers]
    );
    if (parseInt(deletedRooms.rows[0]?.count || '0', 10) > 0) {
      console.log(`🧹 Removed ${deletedRooms.rows[0]!.count} invalid legacy room(s) from inventory`);
    }

    for (const roomSeed of seedRooms) {
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor, last_status_change)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (number) DO UPDATE
           SET type = EXCLUDED.type,
               floor = EXCLUDED.floor,
               updated_at = NOW()
         RETURNING id`,
        [roomSeed.number, roomSeed.type, RoomStatus.CLEAN, roomSeed.floor]
      );

      const roomId = roomResult.rows[0]!.id;

      await query(
        `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET room_id = EXCLUDED.room_id,
               locker_id = NULL,
               is_active = true,
               updated_at = NOW()`,
        [roomId, roomSeed.tagCode]
      );
    }

    console.log(`\n✅ Rooms inventory ensured (${seedRooms.length} rooms)`);

    // Enforce facility inventory contract (delete any invalid legacy lockers)
    const desiredLockerNumbers = seedLockers.map((l) => l.number);
    const deletedLockers = await query<{ count: string }>(
      `WITH del AS (
         DELETE FROM lockers
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`,
      [desiredLockerNumbers]
    );
    if (parseInt(deletedLockers.rows[0]?.count || '0', 10) > 0) {
      console.log(`🧹 Removed ${deletedLockers.rows[0]!.count} invalid legacy locker(s) from inventory`);
    }

    for (const lockerSeed of seedLockers) {
      const lockerResult = await query<{ id: string }>(
        `INSERT INTO lockers (number, status)
         VALUES ($1, $2)
         ON CONFLICT (number) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [lockerSeed.number, RoomStatus.CLEAN]
      );

      const lockerId = lockerResult.rows[0]!.id;

      await query(
        `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET locker_id = EXCLUDED.locker_id,
               room_id = NULL,
               is_active = true,
               updated_at = NOW()`,
        [lockerId, lockerSeed.tagCode]
      );
    }

    console.log(`\n✅ Lockers inventory ensured (${seedLockers.length} lockers, 001–108)`);

    console.log('\nScan tokens for testing (sample):');
    seedRooms.slice(0, 5).forEach((room) => {
      console.log(`  - ${room.tagCode} → Room ${room.number}`);
    });
    seedLockers.slice(0, 5).forEach((locker) => {
      console.log(`  - ${locker.tagCode} → Locker ${locker.number}`);
    });

    // Seed staff users
    console.log('\nSeeding staff users...');

    const staffUsers = [
      {
        name: 'John Erikson',
        role: 'STAFF',
        qrToken: 'STAFF-001',
        pin: '111111',
      },
      {
        name: 'Manager Club',
        role: 'ADMIN',
        qrToken: 'STAFF-002',
        pin: '222222',
      },
      {
        name: 'Manager Dallas',
        role: 'ADMIN',
        qrToken: 'STAFF-003',
        pin: '333333',
      },
      {
        name: 'Employee One',
        role: 'STAFF',
        qrToken: 'STAFF-004',
        pin: '444444',
      },
      {
        name: 'Employee Two',
        role: 'STAFF',
        qrToken: 'STAFF-005',
        pin: '555555',
      },
    ];

    // Check if staff already exist
    const existingStaff = await query<{ count: string }>('SELECT COUNT(*) as count FROM staff');

    if (parseInt(existingStaff.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Staff users already exist. Updating existing staff to match seed data...');

      // Update existing staff if they match old names or create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        // Check if staff with this name or matching old names exists
        const existing = await query<{ id: string; name: string }>(
          `SELECT id, name FROM staff 
           WHERE name = $1 
           OR (name = 'John Staff' AND $1 = 'John Erikson')
           OR (name = 'Jane Admin' AND $1 = 'Cruz Martinez')
           LIMIT 1`,
          [staff.name]
        );

        if (existing.rows.length > 0) {
          // Update existing staff
          await query(
            `UPDATE staff 
             SET name = $1, role = $2, qr_token_hash = $3, pin_hash = $4, active = true
             WHERE id = $5`,
            [staff.name, staff.role, qrTokenHash, pinHash, existing.rows[0]!.id]
          );
          console.log(`✓ Updated staff: ${existing.rows[0]!.name} → ${staff.name} (${staff.role})`);
        } else {
          // Create new staff if doesn't exist
          await query(
            `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES ($1, $2, $3, $4, true)`,
            [staff.name, staff.role, qrTokenHash, pinHash]
          );
          console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
        }
      }

      console.log('\n✅ Staff users updated successfully');
    } else {
      // No existing staff, create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        await query(
          `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ($1, $2, $3, $4, true)`,
          [staff.name, staff.role, qrTokenHash, pinHash]
        );

        console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
      }

      console.log('\n✅ Staff users seeded successfully');
    }

    console.log('\nStaff login credentials for testing:');
    staffUsers.forEach((staff) => {
      console.log(`  - ${staff.name} (${staff.role}):`);
      console.log(`    QR Token: ${staff.qrToken}`);
      console.log(`    PIN: ${staff.pin}`);
    });

    // Seed devices for register use
    console.log('\nSeeding devices...');

    const seedDevices = [
      { deviceId: 'register-1', displayName: 'Register 1' },
      { deviceId: 'register-2', displayName: 'Register 2' },
    ];

    for (const device of seedDevices) {
      const existing = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM devices WHERE device_id = $1',
        [device.deviceId]
      );

      if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
        await query(
          `INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`,
          [device.deviceId, device.displayName]
        );
        console.log(`✓ Seeded device: ${device.displayName} (${device.deviceId})`);
      } else {
        // Update existing device to ensure it's enabled
        await query(`UPDATE devices SET enabled = true, display_name = $1 WHERE device_id = $2`, [
          device.displayName,
          device.deviceId,
        ]);
        console.log(`✓ Updated device: ${device.displayName} (${device.deviceId})`);
      }
    }

    console.log('✅ Devices seeded successfully');

    // Seed active agreement
    console.log('\nSeeding active agreement...');

    const existingAgreement = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM agreements WHERE active = true'
    );

    const agreementBodyText = `<h2 style="text-align:center; margin: 0 0 12px 0;">CLUB DALLAS ENTRY &amp; LIABILITY WAIVER</h2>
<p style="text-align:center; margin: 0 0 18px 0; font-size: 12px;">Effective Date: Today</p>

<p><strong>PLEASE READ CAREFULLY.</strong> This Agreement contains a release of liability and waiver of certain legal rights. By entering Club Dallas ("Club"), you agree to the terms below.</p>

<h3>1. Definitions</h3>
<p>"Club Dallas," "Club," "we," "us," and "our" mean the operator(s), owners, managers, employees, contractors, agents, affiliates, successors, and assigns of Club Dallas and the premises. "Guest," "you," and "your" mean the individual entering the premises.</p>

<h3>2. Voluntary Entry and Assumption of Risk</h3>
<p>You acknowledge that visiting and using the premises involves inherent risks, including but not limited to slips and falls, allergic reactions, exposure to cleaning products, interactions with other guests, and other foreseeable and unforeseeable hazards. You voluntarily assume all risks of injury, illness, property damage, and loss arising from your entry and presence on the premises, whether caused by ordinary negligence or otherwise, to the fullest extent permitted by law.</p>

<h3>3. Release and Waiver of Liability</h3>
<p>To the maximum extent permitted by law, you hereby release, waive, and discharge the Club from any and all claims, demands, damages, losses, liabilities, costs, and causes of action of any kind arising out of or related to your entry, presence, or participation in any activities on the premises, including claims based on the Club's ordinary negligence.</p>

<h3>4. Indemnification</h3>
<p>You agree to indemnify, defend, and hold harmless the Club from and against any claims, damages, liabilities, and expenses (including reasonable attorneys' fees) arising out of or related to your actions, conduct, violations of Club rules, or breach of this Agreement.</p>

<h3>5. Conduct and Compliance</h3>
<p>You agree to comply with all posted rules, staff instructions, and applicable laws. The Club reserves the right to refuse entry or remove any guest at its discretion. You acknowledge that violations of Club rules may result in removal without refund and may be reported to authorities where appropriate.</p>

<h3>6. Health and Fitness Acknowledgment</h3>
<p>You represent that you are physically able to enter and use the premises and that you will not engage in conduct that poses a risk of harm to yourself or others. You are responsible for your own personal property.</p>

<h3>7. Personal Property; Limitation of Responsibility</h3>
<p>The Club is not responsible for lost, stolen, or damaged personal property, including valuables left in lockers, rooms, or common areas, except where liability cannot be excluded by law.</p>

<h3>8. Photo/Video Notice</h3>
<p>To the extent permitted by law, you acknowledge that security monitoring may be in use in certain areas for safety and compliance. The Club does not guarantee privacy in any non-private area. (No statement here authorizes recording in private areas.)</p>

<h3>9. Dispute Resolution</h3>
<p>Any dispute arising out of this Agreement or your entry to the Club shall be resolved in a lawful forum with jurisdiction, under applicable law. If any provision is held unenforceable, the remainder remains in effect.</p>

<h3>10. Entire Agreement</h3>
<p>This Agreement represents the entire understanding regarding entry to the premises and supersedes prior communications on this subject. By signing below, you acknowledge that you have read and understood this Agreement and agree to be bound by it.</p>

<p style="margin-top: 18px;"><strong>ACKNOWLEDGMENT:</strong> I have read this Agreement, understand it, and agree to its terms.</p>`;

    if (parseInt(existingAgreement.rows[0]?.count || '0', 10) > 0) {
      // Update existing active agreement if body_text is empty
      const activeAgreement = await query<{ body_text: string }>(
        'SELECT body_text FROM agreements WHERE active = true LIMIT 1'
      );
      if (
        activeAgreement.rows.length > 0 &&
        (!activeAgreement.rows[0]?.body_text || activeAgreement.rows[0].body_text.trim() === '')
      ) {
        await query(`UPDATE agreements SET body_text = $1 WHERE active = true`, [
          agreementBodyText,
        ]);
        console.log('✓ Updated active agreement with real content');
      } else {
        console.log('⚠️  Active agreement already exists with content. Skipping agreement seed.');
      }
    } else {
      await query(
        `INSERT INTO agreements (version, title, body_text, active)
         VALUES ($1, $2, $3, true)`,
        ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', agreementBodyText]
      );
      console.log('✓ Seeded active agreement: demo-v1');
      console.log('✅ Agreement seeded successfully');
    }
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// CLI entrypoint - run seed when executed directly
seed()
  .then(() => {
    console.log('\nSeed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });

export { seed };
