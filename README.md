# LWH Driver Toolkit v1.30.0

A driver-facing companion to the LWH Warehouse Toolkit, built for Logistics Warehouse drivers. Forked from the Warehouse Toolkit with inventory/transaction/warehouse-print tools removed, and driver-specific tools (HOS Countdown, Trip Fuel Cost, Load Securement reference) and an expanded weather section added.

**Retired modules:** Paper Log Grid, DVIR Inspection, Trailer Inspection Report, HOS Countdown and Status Update (v1.21.0, drivers use Samsara for these), plus Detention Tracker, Contact QR, Generate Code and Scan Code (v1.24.0) are hidden to keep the app simple. Their code is still in the repo; remove a name from `RETIRED_VIEWS` in `js/app.js` to bring one back.

**Unpaid Time Off (v1.25.0):** drivers request unpaid time off and see their requests in the toolkit (`js/timeoff.js`). It uses the same Apps Script backend as the LWH Time Off app, so the Sheet, manager emails and Outlook invites are unchanged. Managers approve in that app's Manager tab.

**Manager tools (v1.25.0):** Dispatch Board, All Timesheets and Fuel Price Board are hidden for drivers. A manager turns them on for their own phone in Settings → Manager Tools with the code in `MANAGER_TOOLS_CODE` (`js/app.js`). This only hides screens; it is not a security lock.

Branding matches the Logistics Warehouse company site (red/black/white) rather than the maroon internal or teal driver-doc-scan palettes.

See CHANGELOG (to be started) for version history.
