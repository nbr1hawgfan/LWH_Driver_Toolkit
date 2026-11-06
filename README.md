# LWH Driver Toolkit v1.39.0

A driver-facing companion to the LWH Warehouse Toolkit, built for Logistics Warehouse drivers. Forked from the Warehouse Toolkit with inventory/transaction/warehouse-print tools removed, and driver-specific tools (HOS Countdown, Trip Fuel Cost, Load Securement reference) and an expanded weather section added.

**Retired modules:** Paper Log Grid, DVIR Inspection, Trailer Inspection Report, HOS Countdown and Status Update (v1.21.0, drivers use Samsara for these), plus Detention Tracker, Contact QR, Generate Code and Scan Code (v1.24.0), and Fuel Surcharge (v1.31.0, now in the Transportation Manager app) are hidden to keep the app simple. Their code is still in the repo; remove a name from `RETIRED_VIEWS` in `js/app.js` to bring one back.

**Unpaid Time Off (v1.25.0):** drivers request unpaid time off and see their requests in the toolkit (`js/timeoff.js`). It uses the same Apps Script backend as the LWH Time Off app, so the Sheet, manager emails and Outlook invites are unchanged. Managers approve in that app's Manager tab.

**Manager tools (v1.25.0):** Dispatch Board, All Timesheets and Fuel Price Board are hidden for drivers. A manager turns them on for their own phone in Settings → Manager Tools with the code in `MANAGER_TOOLS_CODE` (`js/app.js`). This only hides screens; it is not a security lock.

**Messages from Dispatch (v1.39.0):** drivers sign in once with their Driver ID and a 6-digit PIN (`js/messages.js`). Dispatch sends from the **Driver Message Center** (`dispatch/index.html`, live at `/dispatch/`): notices, must-acknowledge messages, and quick replies, to everyone, by location, or to picked drivers, with read receipts, reminders, recall and CSV export. In the Toolkit, the Messages card on Home shows what's new; messages can be read out loud automatically (through truck Bluetooth or a headset), and message text is hidden while the device is moving. The inbox checks every 30 seconds while the app is open. Backend: `supabase/migrations/20261106_driver_messages.sql` (already applied). Who can send = anyone with role **Manager** in the `drivers` table. See `supabase/README.md` for setup codes.

Branding matches the Logistics Warehouse company site (red/black/white) rather than the maroon internal or teal driver-doc-scan palettes.

See CHANGELOG (to be started) for version history.
