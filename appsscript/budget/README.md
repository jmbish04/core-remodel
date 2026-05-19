# Apps Script Project

Google Apps Script project for home remodel budget tracking.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Login to Google Apps Script:
   ```bash
   npm run login
   ```

3. Copy `.clasp.json.example` to `.clasp.json` and add your script ID.

4. Push code to Apps Script:
   ```bash
   npm run push
   ```

## Deployment

The CI/CD workflow automatically deploys changes when code is pushed to the `main` branch.

### Manual Deployment

```bash
npm run deploy
```
