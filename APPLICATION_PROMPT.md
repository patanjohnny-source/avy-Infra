# AVY INFRA — Tile Laying, Workforce & Site Operations Management Platform

Use this document as a complete product breakdown and system specification / prompt to understand, reproduce, audit, or extend the **AVY INFRA** application.

---

## 1. Master Application Prompt

> Build a full-stack React + TypeScript + Tailwind CSS + Express + Firebase Firestore web application for **AVY INFRA**, a tile-laying and stone-finishing construction contractor managing residential/commercial towers, floor-wise flats/units, workforce deployment, daily attendance, food/cash advances, AI-assisted payment screenshot OCR, payroll settlements, custom site expense ledgers, daily tower site logs, and printable QR employee ID badges.
>
> Implement role-based workspace access:
> 1. **Admin**: Full access across all projects, towers, crew, payroll, advances, site expenses, custom expense categories, company ID card branding, role PIN management, and Daily Site Logs.
> 2. **Tower Supervisor**: Scoped strictly to their assigned tower(s) — can view/manage tower crew, mark daily attendance (locked once submitted; editable only via Admin override or explicit edit flow), allocate flat/zone work, record daily food/site expenses, run Advance Sheet OCR, and post Daily Site Logs with tower progress notes & photos.
> 3. **Employee (Worker)**: Read-only personal portal showing attendance calendar, earned wages breakdown, total advances, net payable balance, and recent flat assignments.
>
> Include a public read-only **QR Workforce Pass View** (`?qr=1...` / `?empId=...`) so scanning an employee's printed ID badge displays their deployment status and active flat/zone work without exposing wages, advances, Aadhaar/PAN, or requiring workspace login.

---

## 2. Role & Security Model

| Role | Login Credentials | Scope & Capabilities |
| :--- | :--- | :--- |
| **Admin** | Username/Password or Email + PIN (`admin` / `admin123` default demo) | Full CRUD across projects, towers, floors, flats, tile zones, workforce, attendance lock/edit, payroll settlement, advance approvals, custom expense/advance categories, company ID branding, Google Cloud Firestore sync, and Daily Site Logs. |
| **Supervisor** | Employee Code + PIN (`AVY-SUP-005` / `1234` default demo) | Strictly scoped to `assignedTowerId` (`getScopedTowers`, `getScopedEmployees`, `getScopedAttendance`, `getScopedAdvances`, `getScopedExpenses`, `getScopedAssignments`, `getScopedFlats`). Cannot edit already-marked attendance unless Admin unlocks; cannot delete organization records. |
| **Employee** | Employee Code + PIN (e.g. `AVY-MSN-001` / `1234`) | Read-only personal attendance log, earnings vs. advances balance, and assigned flat zones. |
| **Public QR Pass** | Scanned URL (`?qr=...`) | Read-only deployment & active flat/zone status verification page (`QrScannedProfileView`). No wages, phone, bank, or advance amounts shown. |

---

## 3. Core Functional Modules

### A. Login & Role Access (`LoginPage.tsx`, `AdminAccessModal.tsx`, `authAccess.ts`)
- Dedicated workspace login screen with quick Admin / Supervisor / Employee tabs and workspace PIN configuration.
- Admin can update Admin credentials, Tower Supervisor PINs & assigned towers, and worker Employee Portal PINs inside `AdminAccessModal`.

### B. Dashboard & Executive Summary (`DashboardView.tsx`, `ExecutiveSummarySection.tsx`)
- **Executive Summary (D3 SVG Visualizations)**:
  - **KPI 1 — Total Pending Tasks**: Remaining unfinished tile zones (`not_started`, `prechecking`, `in_progress`, `cleaning_in_progress`) plus completion percentage across scoped projects.
  - **KPI 2 — Current Workforce Utilization**: Active workers currently assigned to open flat tasks vs. total active workforce.
  - **KPI 3 — Expense Burn Rate**: Rolling 30-day total operational spend (Wages + Advances + Site Expenses), average daily burn rate, and projected 30-day burn.
  - **D3 Charts**:
    1. **Task Pipeline Stage Breakdown** (vertical bar chart across Pending, Prechecking, In Progress, Cleaning Running, Cleaning Done, Completed / QC).
    2. **30-Day Daily Expense Burn Trend** (area + line time-series chart with INR axis formatting).
    3. **Tower Workforce Utilization** (horizontal stacked percentage bar chart per tower).
- **Tower-Wise Daily Status Board**: Live attendance (`P / H / A`), daily & monthly food spend, tile completion progress, duration breakdown, and 1-click WhatsApp/Email formatted status sharing (`WhatsappShareModal.tsx`).
- **Recent Activity Panels**: Work assignment history, recent advances, and recent Daily Site Logs preview.

### C. Projects, Towers, Floors & Flat Matrix (`ProjectsFlatsView.tsx`, `AssignWorkModal.tsx`)
- **Hierarchy**: `Project -> Tower (with Incharge, Supervisor, Engineer, PM contacts & start/finish timelines) -> Floor / Level -> Flat / Unit -> Tile-Laying Zones`.
- **Workflow Status Lifecycle**:
  - `not_started` (Pending)
  - `prechecking` (Prechecking)
  - `in_progress` (In Progress)
  - `cleaning_in_progress` (Cleaning In Progress)
  - `cleaning_done` (Cleaning Done)
  - `completed` (Completed)
  - `qc_approved` (QC Approved)
- **Overall Work Progress Filters**: Filter work **All Projects vs. Current Project**, **Tower-wise / Floor-wise / Flat-wise**, and by stage (**All Work, Pending, Prechecking, In Progress, Cleaning Running, Cleaning Done, Completed**).
- **Tile Zone Customization**: Company-wide default catalog + per-flat custom zones (`sqft`, category: Flooring / Bathroom / Kitchen / Utility / Balcony / Skirting / Custom).
- **Unfinished Work Guard**: Configurable rule in `CompanySettingsModal` requiring an employee's running zone task to be completed before assigning a new flat zone.

### D. Workforce, QR ID Cards & Scanned Verification (`WorkforceView.tsx`, `QrScannedProfileView.tsx`, `idCardPdf.ts`)
- Manage masons, helpers, supervisors, rates, bank/UPI details, project/tower deployment, and employee photos.
- **Printable PDF ID Cards & QR Badges**: Dual-sided printable PDF ID cards (using `jspdf` + `qrcode`) embedding compressed QR payloads (`encodeQrCompactPass` + `/qr_passes/{passId}` cloud pass sync) linking to `QrScannedProfileView`.

### E. Attendance, Monthly Register, Advances, OCR & Payroll (`AttendancePayrollView.tsx`, `GiveAdvanceModal.tsx`, `AdvanceScreenshotImportModal.tsx`, `PaymentProofUploadBox.tsx`)
- **Daily Tower Attendance**: Mark `Present`, `Half Day`, `Absent`, `Sunday Off`; Supervisor lock after initial submission (`lockedByRole`) with Admin/edit controls.
- **Monthly Attendance Matrix & Individual Attendance Card PDF**.
- **Food & Cash Advances + Custom Advance Categories**: Daily Food, Weekly Food (Sunday batch run), Cash Advance, or Admin/custom categories.
- **AI Vision Written Advance Sheet OCR (`/api/ocr/advance-sheet`)**: Upload a photo of a handwritten/printed advance sheet -> server calls `@google/genai` Gemini Vision -> returns structured worker names/IDs/amounts -> fuzzy-matched review checklist -> 1-click batch approval posting directly into Advances with screenshot proof attached.
- **UPI / Bank Payment Screenshot OCR (`/api/ocr/payment-proof`)**: Auto-extracts Payment App (`Google Pay`, `PhonePe`, `Paytm`, `Bank`), Amount, Date, Transaction/UTR ID, and UPI ID, compressing & persisting the receipt image to the database (`ImageProofLightboxModal` viewer).
- **Payroll Calculation & Settlement**: Computes `Earned Wages + Bonus - Total Advances - Prior Settlements = Net Payable` with detailed worker payment breakdown and settlement history.

### F. Project & Tower Expenses & Custom Categories (`ExpensesReportsView.tsx`, `CompanySettingsModal.tsx`)
- Cost attribution combining **Crew Wages + Food Advances + Site Material/Operational Bills** per Project and Tower.
- **Custom Expense Categories Configuration**: Admin configures reusable custom expense categories in `CompanySettingsModal` (e.g., `Gas Cylinder Refill`, `Site Medical Kit`, `Auto / Travel Advance`, `Diesel Generator`), which dynamically populate as selectable options inside the Expense Recording modal (`<select id="exp-cat">`) and ledger filter chips.
- Supports PDF & CSV export of project/tower cost summaries.

### G. Daily Site Log (`DailySiteLogView.tsx`)
- Daily progress journal per tower beyond flat-specific statuses.
- Supervisors (scoped to assigned tower) & Admin pick Date, Project, Tower, enter a structured short site note (up to 600 chars), and optionally attach a compressed JPEG site photo (`compressBoundedScreenshotDataUrl`).
- Chronological feed filterable by Project, Tower, Date, or keyword search with full-screen lightbox photo viewing (`ImageProofLightboxModal`) and Admin delete controls.

---

## 4. Technical Stack & Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4 (`@import "tailwindcss";`), `lucide-react`, `d3` (SVG KPI charts), `jspdf`, `qrcode`.
- **Backend (`server.ts`)**: Express server serving Vite in dev and static build in prod, exposing server-side `/api/ocr/payment-proof` and `/api/ocr/advance-sheet` endpoints using `@google/genai` (`GEMINI_API_KEY` kept strictly server-side).
- **Persistence & Sync (`StoreContext.tsx`, `firebase-blueprint.json`, `firestore.rules`)**:
  - Offline-first LocalStorage cache + Firebase Authentication & Cloud Firestore real-time `onSnapshot` listeners.
  - Collections: `companies`, `projects`, `towers`, `flats`, `employees`, `assignments`, `attendance`, `advances`, `expenses`, `settlements`, `site_logs`, `qr_passes`.
  - Pure calculation & normalization utilities in `src/utils/` (`tileZones.ts`, `payroll.ts`, `operations.ts`, `authAccess.ts`, `qrProfile.ts`, `imageOcr.ts`, `cloudSync.ts`) covered by Node native tests (`npx --yes tsx --test src/utils/*.test.ts`).
