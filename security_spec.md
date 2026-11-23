# AVY INFRA Firestore Security Specification

## 1. Data Invariants
1. **Strict Workspace Ownership**: Every record in `projects`, `towers`, `flats`, `employees`, `employee_backups`, `assignments`, `attendance`, `advances`, and `settlements` has an immutable `ownerId` matching `request.auth.uid` of a verified user (`email_verified == true`).
2. **Relational Integrity**:
   - A `tower` cannot be created unless its `projectId` exists and belongs to `request.auth.uid`.
   - A `flat` cannot be created unless its `projectId` and `towerId` exist and belong to `request.auth.uid`.
   - A `workAssignment` cannot be created unless `projectId`, `towerId`, `flatId`, and `employeeId` exist and belong to `request.auth.uid`.
   - An `attendance`, `advance`, or `settlement` record cannot be created unless `employeeId` exists and belongs to `request.auth.uid`.
   - Historical `attendance`, `advances`, `settlements`, `deployments`, and `assignments` are preserved when an employee is archived to `employee_backups` and removed from active `employees`.
3. **Temporal Integrity**: `createdAt` and `updatedAt` are server timestamps (`request.time`) on creation; `createdAt` is immutable on update and `updatedAt == request.time`. `employee_backups` snapshots are append-once (`allow update: if false;`) and can only be deleted by the verified `ownerId` upon restore or permanent purge.
4. **PII Protection**: Employee phone numbers, Aadhar references, backup snapshots (`employee_backups`), and emergency contacts are strictly isolated to `ownerId == request.auth.uid`. No unauthenticated or cross-user read/list is permitted.
5. **Non-PII QR Pass Isolation**: `qr_passes/{passId}` contains zero PII (no phone, email, Aadhaar, PF/ESI, emergency contacts, or wages), requires an unguessable `>= 16`-char pass ID for single-document `get`, and restricts `list` and writes to the verified `ownerId`.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Cross-Tenant Read**: User B attempts `get` on `/employees/emp_userA` or `/employee_backups/bak_userA`. Denied by `existing().ownerId == request.auth.uid`.
2. **Blanket List Scraping**: User B attempts `list` on `/employees` or `/employee_backups` without `where('ownerId', '==', uid)`. Denied by `resource.data.ownerId == request.auth.uid`.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts `create` on `/projects/p1`. Denied by `isVerified()`.
4. **Identity Spoofing**: User B creates `/projects/p2` or `/employee_backups/b1` with `ownerId: "userA"`. Denied by `data.ownerId == request.auth.uid`.
5. **Shadow / Ghost Field Injection**: User creates `/employees/e1` or `/employee_backups/b1` with extra field `isAdmin: true`. Denied by `data.keys().hasOnly(...)`.
6. **ID Poisoning (1KB ID)**: User creates `/flats/<1500_char_id>`. Denied by `isValidId(flatId)`.
7. **Orphaned Tower Write**: User creates `/towers/t1` referencing non-existent `projectId: "missing"`. Denied by `exists()`/`get()` parent check.
8. **Cross-Tenant Relational Hijack**: User B creates `/assignments/a1` referencing User A's `flatId`. Denied by parent `get().data.ownerId == request.auth.uid`.
9. **Client Timestamp Forgery**: User creates `/advances/adv1` with `createdAt` backdated 30 days. Denied by `incoming().createdAt == request.time`.
10. **Immutable Field Mutation**: User updates `/employees/e1` to change `ownerId` or `createdAt`, or tries to update `/employee_backups/b1`. Denied by `incoming().ownerId == existing().ownerId`, `incoming().createdAt == existing().createdAt`, and `allow update: if false;`.
11. **Role / Wage Type Poisoning**: User updates `/employees/e1` with `dailyRate: "not_a_number"` or `role: "SuperAdmin"`. Denied by `isValidEmployee(incoming())`.
12. **Unbounded Array / String Exhaustion**: User creates `/advances/adv2` with 50KB `notes` string or `/employee_backups/b2` with 20 documents. Denied by `data.notes.size() <= 300` and `data.documents.size() <= 5`.
