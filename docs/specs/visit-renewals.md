# Visit Renewals (2h / 6h)

This document defines renewal rules for extending an active visit from the employee register.

## Eligibility

- A renewal applies only to an **active visit** (ended_at is null).
- A renewal can be started **within 1 hour of the current checkout time**.
- The total consecutive visit duration **must not exceed 14 hours** after renewal.
- Renewal hours must be **2 or 6**.
- Renewal start time is the **previous block’s end time** (not “now”).

## Block Types

- **6-hour renewal** → `checkin_blocks.block_type = RENEWAL`
- **2-hour renewal** → `checkin_blocks.block_type = FINAL2H`
- Multiple `FINAL2H` blocks are allowed as long as the 14-hour cap is respected.

## Pricing

- **2-hour renewal**: $20 flat renewal fee **plus** the daily membership fee (non-members only).
- **6-hour renewal**: full base check-in pricing (same structure as a standard check-in),
  including the daily membership fee when applicable.
- Valid 6‑month members **do not pay** the daily membership fee.
- If a 6‑month membership purchase intent is included, the daily membership fee is waived
  and the 6‑month membership fee is added to the quote.

## Employee Register UX

- Renewals are initiated from the Customer Account screen.
- Options are **direct select** (no kiosk proposal/confirmation).
- The payment modal shows:
  - **Today’s ledger** (paid check-ins + charges recorded today), then
  - **Renewal line items** (membership fee + renewal fee or full room/locker cost).

## API Touchpoints

- `/v1/checkin/lane/{laneId}/start` with `visitId` + `renewalHours`
- `/v1/checkin/lane/{laneId}/create-payment-intent` (uses renewal pricing)
- `/v1/visits/{id}/renew` (direct renewal for backoffice workflows)
