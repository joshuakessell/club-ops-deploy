## QA Checklist: i18n + Membership Purchase/Renewal Flows

This checklist validates:
- Spanish translation coverage on the Customer Kiosk
- Membership status rules (Active vs Expired vs None)
- Purchase + renewal flows (pending → quote → paid → membership activation)
- Renewal option: keep same ID vs overwrite ID

---

## i18n (Customer Kiosk)

### Preconditions
- A lane session exists for the kiosk (customer shown).
- Customer language is Spanish (`ES`) **or** language selection screen is shown and you pick Spanish.

### Steps
- **Language selection**
  - If prompted, choose **Español**.
  - Verify the kiosk does **not** keep prompting again for the same session once language is known.
- **Key screens in Spanish**
  - Verify the following screens show Spanish UI text:
    - Orientation overlay (portrait required)
    - Membership section labels + CTAs
    - Membership purchase/renew modal (title/body/buttons)
    - Waitlist modal copy (if triggered)
    - Payment screen labels (“Total a Pagar”, “Cargos”, etc.)
- **English leakage guard**
  - In Spanish mode, verify obvious English CTA strings do not appear (e.g. “Purchase 6 Month Membership”, “Non‑Member”).

---

## Membership Status Rules

### Rules (expected behavior)
- **Stored fields**: customer record has `membership_number` and `membership_valid_until` (date).
- **Validity is inclusive**: membership is active **through** the `membership_valid_until` date.
- **Expired the day after**: it becomes expired starting the next day.
- **Expired membershipId remains**: the system keeps `membership_number` for lookup/identity, but treats pricing/UI as non-member.

### Cases to validate on Customer Kiosk
- **Active member**
  - membership number present
  - valid-until is today or in the future
  - Kiosk shows **Member** (no purchase/renew CTA).
- **Expired member**
  - membership number present
  - valid-until in the past (yesterday or older)
  - Kiosk shows **Non‑Member + Expired** and offers **Renew Membership** (not Purchase).
- **Non-member**
  - no membership number
  - Kiosk shows **Non‑Member** and offers **Purchase 6 Month Membership**.

---

## Purchase Flow (Non‑Member → Member Pending → Active Member)

### Preconditions
- Customer has **no** `membership_number` (Non‑Member).
- Customer is in an active lane session.

### Steps
1. On kiosk, tap **Purchase 6 Month Membership**.
2. Verify modal explains: save on daily fees; 6‑month membership costs **$43**.
3. Tap **Cancel** → modal closes, status unchanged.
4. Tap **Continue** →
   - Kiosk shows **Member (Pending)**.
   - Employee Register’s **Payment Quote** shows a line item **“6 Month Membership” $43.00**.
   - Confirm it does **not** duplicate if the session updates multiple times.
5. In Employee Register, proceed normally (selection/assignment flow still works).
6. Mark paid in Square (employee presses **Mark Paid in Square**).
7. Employee Register should prompt for **Membership ID** (scanner wedge supported):
   - Scan the physical membership card number (keyboard input) and press **Enter**.
8. Verify results:
   - Customer record now has `membership_number` saved
   - `membership_valid_until` is set to **today + 6 months**
   - Kiosk updates from **Member (Pending)** → **Member** (active)

---

## Renewal Flow (Expired → Renew Pending → Active Member)

### Preconditions
- Customer has `membership_number` present
- `membership_valid_until` is expired (in the past)
- Customer is in an active lane session

### Steps
1. On kiosk, tap **Renew Membership**.
2. Verify modal explains: 6‑month membership costs **$43**.
3. Tap **Continue** →
   - Kiosk shows **Member (Pending)**.
   - Employee Register Payment Quote includes **“6 Month Membership” $43.00** (no duplicates).
4. Mark paid in Square.
5. Employee Register prompts for membership ID and shows **two renewal options**:
   - **Keep Same ID** (membership number remains unchanged)
   - **Enter New ID** (overwrites membership number)
6. Validate both branches:
   - **Keep Same ID**
     - Save without changing the ID
     - Verify `membership_valid_until` updated to **today + 6 months**
   - **Enter New ID**
     - Scan/type new membership ID and save
     - Verify `membership_number` updated to the new ID
     - Verify `membership_valid_until` updated to **today + 6 months**
7. Verify kiosk updates to **active Member** after save.

---

## Regression Checks
- Membership quote item remains attached until cleared/paid; no duplicates from repeated updates.
- After membership activation, kiosk no longer shows **Pending** and no longer offers Purchase/Renew for active members.
- Membership lookup continues to work for expired members (membership number still present).


