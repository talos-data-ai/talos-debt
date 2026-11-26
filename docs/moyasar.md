# Moyasar: from account to live payments (step 7.6b)

Talos takes subscription payments through Moyasar (approved by Sal, 26 November 2026). The code is in `api/src/billing/` (see CLAUDE.md, "Subscription payments"). This page lists what has to happen outside the code, in order.

## 1. The account (Sal)

- [x] Account created (26 November 2026).
- [ ] Activation form, with the establishment's commercial registration and a Saudi bank account in its name (an IBAN letter from the bank).
- [ ] From Moyasar's sales team, in writing:
  - the fees for mada, Visa and Mastercard, and Apple Pay;
  - **recurring payments with saved cards turned on, including mada** (Talos charges saved cards at every renewal, without asking the cardholder again);
  - Apple Pay for `debt.talosksa.com` and the dashboard's address;
  - how many days until money reaches the bank.
- [ ] Moyasar reviews the website: what Talos sells, the prices, the refund and cancellation policy (`/refunds/`, approved by the lawyer) and how to contact us. The site must be live first (7.1b).

## 2. The sandbox run (Sal or Karam, on a computer that can reach Moyasar)

Claude's workspace cannot reach Moyasar, so this runs on a developer's computer or where the API is hosted.

1. In Moyasar's dashboard, switch to test mode and copy the **test** keys (Settings, API keys).
2. Put them in `api/.env`, never in the chat or the repository:
   ```
   MOYASAR_SECRET_KEY=sk_test_...
   MOYASAR_PUBLISHABLE_KEY=pk_test_...
   MOYASAR_WEBHOOK_SECRET=<a random secret of at least 24 characters>
   ```
3. `cd api && npm run moyasar:sandbox`. It checks both keys, saves Moyasar's test card, asks you to open the test bank page, charges 1 riyal twice with the same id (the second time must give back the same payment), reads it back and forgets the card. No real money moves.
4. Send Claude the output. It holds no keys.

To try the whole dashboard against the sandbox on your computer: set `PAYMENT_DRIVER=moyasar` and `PRICING_FILE` in `api/.env`, start the API and the dashboard, and add Moyasar's test card in Settings, then Billing.

## 3. Going live (Karam, with 6.3 and 6.4)

1. Live keys (`sk_live_`, `pk_live_`) go straight into the secret manager. The API refuses test keys in production and live keys anywhere else.
2. Set `PAYMENT_DRIVER=moyasar`, `MOYASAR_WEBHOOK_SECRET` and `PRICING_FILE` for the API and the scheduler.
3. Add the webhook: `npm run moyasar:sandbox -- --webhook https://<API address>/webhooks/moyasar` in test mode first, then the same in Moyasar's dashboard for live mode, with events `payment_paid` and `payment_failed` and the same secret. Moyasar sends a code to a new webhook; the API confirms it on its own, so the API must be running.
4. Turn on Moyasar's allowed addresses list (Settings) with the API's and the scheduler's outgoing addresses, so the secret key works from nowhere else.
5. Apple Pay: verify the domain in Moyasar's dashboard once the site is hosted.
