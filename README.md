# LWH Driver Toolkit v1.41.0

A driver-facing companion to the LWH Warehouse Toolkit, built for Logistics Warehouse drivers. Forked from the Warehouse Toolkit with inventory/transaction/warehouse-print tools removed, and driver-specific tools (HOS Countdown, Trip Fuel Cost, Load Securement reference) and an expanded weather section added.

**Retired modules:** Paper Log Grid, DVIR Inspection, Trailer Inspection Report, HOS Countdown and Status Update (v1.21.0, drivers use Samsara for these), plus Detention Tracker, Contact QR, Generate Code and Scan Code (v1.24.0), and Fuel Surcharge (v1.31.0, now in the Transportation Manager app) are hidden to keep the app simple. Their code is still in the repo; remove a name from `RETIRED_VIEWS` in `js/app.js` to bring one back.

**Unpaid Time Off (v1.25.0):** drivers request unpaid time off and see their requests in the toolkit (`js/timeoff.js`). It uses the same Apps Script backend as the LWH Time Off app, so the Sheet, manager emails and Outlook invites are unchanged. Managers approve in that app's Manager tab.

**Manager tools (v1.25.0):** Dispatch Board, All Timesheets and Fuel Price Board are hidden for drivers. A manager turns them on for their own phone in Settings → Manager Tools with the code in `MANAGER_TOOLS_CODE` (`js/app.js`). This only hides screens; it is not a security lock.

**Messages from Dispatch (v1.39.0):** drivers sign in once with their Driver ID and a 6-digit PIN (`js/messages.js`). Dispatch sends from **Driver Messages** in the Transportation Manager app, which shows the Driver Message Center (`dispatch/index.html`) inside that app — opening `/dispatch/` on its own forwards there (add `?standalone=1` to open it by itself): notices, must-acknowledge messages, and quick replies, to everyone, by location, or to picked drivers, with read receipts, reminders, recall and CSV export. In the Toolkit, the Messages card on Home shows what's new; messages can be read out loud automatically (through truck Bluetooth or a headset), and message text is hidden while the device is moving. The inbox checks every 30 seconds while the app is open. Backend: `supabase/migrations/20261106_driver_messages.sql` (already applied). Who can send = anyone with role **Manager** in the `drivers` table. See `supabase/README.md` for setup codes.

**Files and Message Dispatch (v1.40.0):** dispatch can attach a BOL/PDF or photo to any message (Send tab, or when answering a driver). The Toolkit saves files on the device as soon as the message arrives, so they open full screen with no signal — handy to show at a pickup. Drivers can tap **Message Dispatch** when stopped: pick a topic (Where to next?, Trailer not loaded, Running late, Waiting at customer, Equipment problem, Call me), add text or a photo, and their location goes along. Those land in the Message Center's **Driver Inbox** (unread badge, chime, map link, photos), and answers go back in the same thread. Files are removed after 14 days; messages and receipts stay.

**Launch Samsara and WEX (v1.41.0):** Home → Quick Access and the menu have **Samsara Driver** and **WEX CardControl** buttons that open those apps (`js/launch.js`). On the truck tablets in Fully Kiosk Browser it uses Fully's app launcher — turn on *Advanced Web Settings → Enable JavaScript Interface* in Fully, and add both apps to Fully's allowed apps. On an Android phone it opens the app, or its Play Store page if it isn't installed. On an iPhone it opens the App Store page (iOS doesn't let a web app open another app by name). Package names: `com.samsara.driver`, `com.efsllc.efsmobileapp`.

Branding matches the Logistics Warehouse company site (red/black/white) rather than the maroon internal or teal driver-doc-scan palettes.

See CHANGELOG (to be started) for version history.
