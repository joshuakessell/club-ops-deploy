## Check-in persistence + live refresh smoke checklist (regression)

### Setup

- Ensure demo DB has **exactly 1 CLEAN, unassigned Standard room** (e.g. Room **200**) and no other CLEAN Standard rooms.
- Ensure an **active agreement** exists.
- Open **employee-register** (lane 1), **customer-kiosk** (lane 1), and optionally **office-dashboard**.

### Steps

- **Start lane session** for Customer A.
- On kiosk, select **Double/Special** (any tier that is unavailable) and confirm the **backup tier = Standard** so a waitlist is expected.
- Complete demo payment as **success**.
- Capture signature and complete agreement step.
- In employee-register, click **“Verify agreement PDF + signature saved”** and confirm:
  - `AGREEMENT_PDF` shows **PDF stored: yes**
  - **Signature stored: yes**
  - PDF download opens successfully

### Assertions (must happen immediately, without waiting for polling)

- **Inventory**: call `GET /v1/inventory/available`
  - Room 200 must not be counted/available anymore.
- **Waitlist**: waitlist entry appears in employee-register left panel immediately after creation (no ~30s delay).
- **Documents**: call `GET /v1/documents/by-session/:sessionId`
  - returns at least 1 document with `doc_type=AGREEMENT_PDF`, `has_signature=true`, and `has_pdf=true`
