# QA Checklist — Club Dallas POS Upgrade

This QA script mirrors the automated tests and is intended for on-device validation (iPad + Honeywell keyboard-wedge scanner).

---

## 1) Language persistence

- **Setup**:
  - Have an existing customer record in `customers` with `primary_language` unset.
  - Ensure employee-register and customer-kiosk are connected to the same lane.

- **Steps**:
  - In employee-register, **manually select a customer** (search + confirm).
  - On customer-kiosk, confirm the **language selection screen** appears.
  - Tap a language (EN or ES).
  - Verify customer-kiosk proceeds to the next view (selection/payment gating as applicable).
  - Simulate “reload”:
    - Refresh the kiosk page (or restart the kiosk app).
    - Re-open the same customer/lane session (employee-register confirm customer again if needed).

- **Expected**:
  - **Language prompt does not reappear** for the same customer once `primary_language` is set.
  - Kiosk proceeds directly to the next appropriate screen.

---

## 2) Scan Mode input capture (Honeywell keyboard-wedge)

- **Setup**:
  - Connect Honeywell scanner via the mount USB hub.
  - Ensure no text input field is focused.

- **Steps**:
  - In employee-register, tap **Scan** to open full-screen Scan Mode.
  - Scan a barcode that ends with **Enter** suffix.
  - Scan a barcode that does **not** send Enter/Tab (idle timeout termination).
  - Scan a multi-line PDF417 (state ID) and confirm the captured data is handled (no truncation at first newline).
  - Press **Cancel**.

- **Expected**:
  - Scanner keystrokes do **not** type into random fields outside Scan Mode.
  - Scan Mode shows **Scanning…** then **Processing…** on capture.
  - Enter/Tab or timeout reliably terminates a scan.
  - Multi-line scans are preserved (PDF417).
  - Cancel always exits Scan Mode cleanly.

---

## 3) Matching logic (backend)

Test each match type using known fixtures:

- **ID scan matches by `id_scan_hash` / `id_scan_value`**:
  - Scan the same state ID twice.
  - Expected: second scan should **instantly match** the existing customer.

- **Membership barcode matches by membership id**:
  - Scan a membership identifier that exists in `customers.membership_number`.
  - Expected: customer matches and opens.

- **Fallback name + DOB enrich**:
  - Start with a customer that has `name` + `dob`, but no `id_scan_hash/value`.
  - Scan that customer’s state ID.
  - Expected: customer matches via name+DOB and the system **writes** `id_scan_hash/value` so the **next** scan matches instantly.

---

## 4) Agreement sync (kiosk → employee-register)

- **Setup**:
  - Create a lane session that reaches the agreement step (selection locked + payment marked PAID).

- **Steps**:
  - On customer-kiosk, sign agreement and submit.
  - Observe employee-register without refreshing.
  - On customer-kiosk complete screen, tap **OK**.

- **Expected**:
  - Employee-register updates to show **Agreement signed** within seconds (via `SESSION_UPDATED`).
  - No manual refresh required.
  - Kiosk returns to **idle** (logo-only), ready for next customer.


