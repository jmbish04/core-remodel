# Company Viewports and Bid Portfolio Configuration

The goal of this plan is to restructure the management of Companies into dedicated views rather than dialogs within the Bid Portfolios app, and to vastly improve the Bid Portfolio creation process with a robust intake wizard.

## User Review Required

> [!WARNING]
> This plan introduces new schemas and overhauls the portfolio creation logic. Please review the proposed `bid_portfolio_selected_photos` schema and the multi-step wizard flow to ensure it matches your expectations.

## Open Questions

(No open questions at this time. The feedback on the `business_types` and `companies` schemas has been incorporated below).

## Proposed Changes

### Database Schemas

We will decouple contacts and companies into standard relational tables, driven by a predefined business types taxonomy. We will also add a bridging table to map specific portfolio configurations to explicit photo selections.

#### [NEW] `src/backend/db/schema/directory/business_types.ts`
- Table: `business_types`
- Fields: `id` (auto PK), `name` (text), `description` (text).
- Used to seed the dropdown options for company types (e.g. cabinet makers, stone fabricators, flooring contractors, landscapers, other).

#### [NEW] `src/backend/db/schema/directory/companies.ts`
- Table: `companies`
- Fields: `id`, `name`, `business_type_id` (FK to `business_types.id`), `website`, `license_number`, etc.
- Represents a unified business entity.

#### [NEW] `src/backend/db/schema/directory/company_contacts.ts`
- Table: `company_contacts`
- Fields: `id`, `company_id` (FK to `companies.id`), `contact_id` (FK to `contacts.id`), `title` (text).
- Maps a contact to a company (Rolodex mapping).

#### [MODIFY] `src/backend/db/schema/bid-portfolios/contacts.ts`
- Remove embedded company fields (`companyName`, `businessType`, `website`, `licenseNumber`).

#### [NEW] `src/backend/db/schema/bid-portfolios/bid_portfolio_selected_photos.ts`
- Links `portfolioId`, `roomId`, and `imageId`.
- Fields: `id`, `portfolio_id`, `room_id`, `image_id`, `caption_override`, `sort_order`.

---

### Backend API Updates

#### [MODIFY] `src/backend/api/routes/bid-portfolios.ts`
- **Business Types:** Expose `GET /api/bid-portfolios/business-types` to fetch all seeded business types.
- **Companies CRUD:** Expose endpoints for `GET /api/bid-portfolios/companies`, `POST`, `PUT`.
- **Company Rolodex Endpoint:** Add `GET /api/bid-portfolios/companies/:companyId/contacts` to fetch mapped contacts for the rolodex.
- **Portfolio Creation:** Refactor `POST /api/bid-portfolios` to accept a nested intake structure. It will execute a transaction to insert the portfolio, the room configurations (`bidPortfolioRoomConfigs`), and the specific photo selections (`bidPortfolioSelectedPhotos`).

#### [MODIFY] `src/backend/api/routes/bid-portfolio-public.ts`
- Update the public viewer endpoints to return the specific photos and captions defined in `bid_portfolio_selected_photos` rather than just fetching all photos for the room.

---

### Frontend Pages and Routes

We will create dedicated Astro pages to house the new applications.

#### [NEW] `src/frontend/pages/admin/companies/index.astro`
- Houses the `CompaniesListApp` for the list viewport.

#### [NEW] `src/frontend/pages/admin/companies/[id].astro`
- Houses the `CompanyDetailApp` for the company viewport.

#### [MODIFY] `src/frontend/pages/admin/bid-portfolios/index.astro`
- Will be updated to use the new `BidPortfolioIntakeWizardApp` for creation instead of the simple dialog.

---

### React Frontend Apps

#### [NEW] `src/frontend/components/CompaniesListApp.tsx`
- Fetches all companies and groups them by `businessType` (via join/mapping).
- Alphabetical list with quick links to the Company Viewport.
- Button to create a new company. Dropdown for `businessType` is populated by fetching the `business_types` table.

#### [NEW] `src/frontend/components/CompanyDetailApp.tsx`
- The dedicated "Company Viewport".
- Renders company details and edit form.
- Renders the **Rolodex** (other contacts at this company).
- Shows Permit Intelligence (Insights and Recent Permits).
- Shows Bid History (links to portfolios sent to this company).
- Placeholders for CSLB license check, online reviews, and lawsuits.
- Direct entry point to "Create Bid Profile" for this company.

#### [NEW] `src/frontend/components/BidPortfolioIntakeWizardApp.tsx`
- A multi-step wizard replacing the simple dialog creation.
- **Step 1: Basics:** Title, Welcome Message, Overview, Expiration.
- **Step 2: Sections:** Multi-select dropdown/list to choose which rooms to include.
- **Step 3: Configurations:** For each selected room, configure:
  - Toggles for Dimensions, Condition Notes, Scope Items, Inspiration, Budget.
  - Photo picker to select specific photos from the room's gallery.
  - Ability to write a custom caption for each selected photo.

#### [MODIFY] `src/frontend/components/BidPortfoliosApp.tsx`
- Remove the old company edit dialogs and "Contacts" tab, replacing them with links to `/admin/companies`.
- Update the "Create Portfolio" button to launch the `BidPortfolioIntakeWizardApp` instead of the legacy dialog.

## Verification Plan

### Automated Tests
- Run `cf-typegen` to ensure the new schema types and bindings are correct.
- Ensure the transaction logic in `POST /api/bid-portfolios` safely rolls back on failure.

### Manual Verification
1. Navigate to `/admin/companies` and verify grouping and alphabetical sorting.
2. Click a company to enter the Viewport (`/admin/companies/:id`) and ensure Rolodex, Permits, and Bids populate correctly.
3. Launch the new Bid Portfolio Intake Wizard.
4. Select a subset of rooms, pick 2 specific photos for a room, add a custom caption, and save.
5. Visit the public Bid Portfolio link and verify only the selected rooms and specific photos with custom captions are displayed.
