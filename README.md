# Salon Telegram Bot (Netlify)

Telegram bot for beauty salon booking using Google Sheets.

## Setup

1. Create a Google Cloud Service Account with Sheets API enabled.
2. Share the spreadsheet with the service account email.
3. Set environment variables in Netlify:
   - `TELEGRAM_TOKEN`
   - `SPREADSHEET_ID`
   - `GOOGLE_CREDENTIALS` (full JSON key as string)

4. Deploy and set Telegram webhook to `https://your-site.netlify.app/.netlify/functions/bot`
