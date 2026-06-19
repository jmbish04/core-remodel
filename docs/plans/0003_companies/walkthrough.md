# Admin Dashboard and Bidding Refactor Walkthrough

I have completed the requested shift to the `Company`-centric architecture and built the new Bid Intake Wizard and Company Viewport.

## Database Migrations

- Resolved the blocking migration issue where `drizzle-kit generate` required interactive input.
- Successfully applied the schema changes which included:
  - Creating `business_types`, `companies`, `company_contacts`, and `bid_portfolio_selected_photos` tables.
  - Resolving SQLite's constraints on dropping columns from tables with foreign keys by safely re-creating the `bid_portfolios` table and mapping over existing records.
  - Applied the migration locally.

## Company Viewport & Admin Flow

- **Companies List** (`/admin/companies/`): Shows all vendors grouped by their Business Type (Contractor, Architect, etc.), displaying contact info and license numbers. Includes a wizard to add new companies.
- **Company Viewport** (`/admin/companies/:id`): Detailed viewport containing:
  - **Permit Intelligence:** Real-time summary and recent project history of the contractor based on active building permits.
  - **Company Rolodex:** Mapped contacts using the new `company_contacts` join table (supports multiple contacts per company with primary flags).
  - **Bid History & Compliance Checks:** Placeholders for CSLB license checks, online review checks, and lawsuit histories.
  - Ability to spawn a new bid request specifically for this company.

## Bid Intake Wizard

- **New Intake Page** (`/bid-portfolios/new`): A dedicated 3-step wizard replacing the old modal.
- **Step 1:** Select target company, set bid package title, custom messages, and configure budget visibility.
- **Step 2:** Select which rooms to include, and specifically toggle whether to share photos, dimensions, current conditions, or future scope *per room*.
- **Step 3:** Review and confirm generation. Automatically redirects to the company's viewport once built.

## Verification
You can manually test these features by visiting:
- [Companies Directory](https://core-remodel.hacolby.workers.dev/admin/companies)
- [New Bid Portfolio Wizard](https://core-remodel.hacolby.workers.dev/bid-portfolios/new)
