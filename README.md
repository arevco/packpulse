# PackPulse — Nulogy API Integration

## What This Adds
Adds a "Sync from Nulogy" panel to PackPulse's data upload screen. Pulls inventory, work orders, and BOMs directly from Nulogy's Operational Solution Reports API, eliminating the need for manual CSV exports.

Manual CSV upload is preserved as a fallback alongside the sync.

## Files to Add to Your Repo

```
api/nulogy/create.js     — Creates Nulogy report jobs
api/nulogy/status.js     — Polls report generation status
api/nulogy/download.js   — Downloads + transforms CSV data
api/nulogy/test.js       — Tests credential connection
src/NulogySync.jsx       — Frontend sync component
src/PackPulse.jsx        — Updated (NulogySync integrated)
vercel.json              — Vercel serverless config
```

## Deployment Steps

### 1. Add files to your repo
Copy all files above into your `packpulse` GitHub repo, matching the directory structure.

### 2. Set Vercel Environment Variables
Go to **Vercel → your project → Settings → Environment Variables** and add:

| Variable | Value | Required |
|----------|-------|----------|
| `NULOGY_USER` | Your Nulogy integration user email | Yes |
| `NULOGY_PASS` | Your Nulogy integration user password | Yes |
| `NULOGY_SITE_UUID` | Your site UUID (if multi-site) | Optional |
| `NULOGY_URL` | Custom Nulogy URL (default: `https://app.nulogy.net`) | Optional |

**Finding your Site UUID:** In Nulogy, go to the bottom nav → click "Site" → UUID is listed near the top.

### 3. Deploy
Push to GitHub. Vercel auto-deploys. The Nulogy sync panel will appear on the PackPulse upload screen.

## How It Works

### API Flow (3-step async process)
1. **POST** `/api/nulogy/create` → Tells Nulogy to generate a report in the background
2. **GET** `/api/nulogy/status` → Polls every 4 seconds until report is ready
3. **GET** `/api/nulogy/download` → Downloads CSV from S3, transforms column names, returns JSON

### Reports Pulled
| PackPulse Data | Nulogy Report | Key Columns |
|---|---|---|
| Inventory | `inventory_snapshot` | item_code, item_description, base_quantity |
| Work Orders | `project_status` | project_code, item_code, units_expected, units_produced, units_remaining, due_date_at, customer_name, standard_units_per_hour, standard_people |
| BOMs | `bom` | finished_good_code, subcomponent_code, subcomponent_unit_quantity, substitute_for, priority |

### Security
- Credentials stored as Vercel environment variables (never in browser)
- Backend proxy prevents CORS issues and credential exposure
- HTTP Basic Auth per Nulogy API spec
- Credential test endpoint masks the email in responses

## Nulogy Prerequisites
- An **integration user** account in Nulogy Operational Solution
- The user must have permission to run reports via the API
- The user should NOT have the "Customer" role (blocks some columns)
- For financial columns (costs, charges), the user needs Financial Access
