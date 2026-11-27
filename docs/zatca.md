# Tax invoices and ZATCA (step 7.8)

Talos's own invoices to its clients: every paid subscription charge gets a
tax invoice, and a refund gets a credit note. This page is the road from the
code in the repository to real invoices cleared by ZATCA.

## What the code does

- **Standard tax invoices** (ZATCA type `0100000`), because every client is a
  company. Written as UBL 2.1 XML by `api/src/billing/zatca/xml.ts`, already in
  canonical form, so the invoice hash is the SHA-256 of exactly those bytes.
- **One chain** (`app.invoice_chain`, migration 0012): every document takes the
  next counter (ICV) and the hash of the one before (PIH), inside the same
  transaction that saves it. It never skips or repeats, even with several
  workers. The first document carries ZATCA's starting hash (of `"0"`).
- **Clearance:** after saving, the document is sent to ZATCA
  (`POST /invoices/clearance/single`). Only a cleared document reaches the
  client, with ZATCA's QR code. If ZATCA cannot be reached, the same document
  is sent again (after 2, 4, 8... minutes, at most every 6 hours). If ZATCA
  refuses it, it is never given out, Talos is told in the logs and the client
  sees "being checked"; once the client fixes its details, a new document is
  issued in the chain.
- **Before Talos is connected** (`ZATCA_MODE=off`): the same documents are made
  and kept, with the basic QR code (seller, VAT number, time, total, tax), and
  are ready at once. This is how invoices work until the onboarding below.
- **The client's national address** is needed for every invoice (ZATCA rule
  BR-KSA-63). A card cannot be added without it; a company that paid before
  giving it is told once and gets its invoice as soon as it adds it.
- **Refunds:** a refund made in Moyasar's dashboard reaches the API through the
  `payment_refunded` webhook, and a credit note is issued for what was given
  back. A refund whose amount cannot be split into a net amount plus exactly
  15% (rare) is written to the logs for a person to issue by hand.
- **The PDF** the client downloads shows exactly what the XML says, read back
  from it, in Arabic and English, with the QR code; the XML is attached inside
  the PDF.

## What Talos needs first

1. **VAT registration.** Only a business registered for VAT issues tax
   invoices and charges VAT. Until Talos's establishment has a VAT number,
   leave `SELLER_VAT_NUMBER` empty: no invoices are made, payment emails stay
   receipts. Note that the prices file adds 15% VAT today (`vat` in the
   prices file): if Talos is not registered, that must change before the first
   real charge.
2. **The seller's details** as registered: `SELLER_NAME`, `SELLER_VAT_NUMBER`,
   `SELLER_CR`, and the national address (`SELLER_BUILDING`, 4 digits,
   `SELLER_STREET`, `SELLER_DISTRICT`, `SELLER_CITY`, `SELLER_POSTAL`, 5 digits).

## Connecting to ZATCA (7.8b)

ZATCA's servers cannot be reached from Claude's workspace, so these steps run
on a developer's machine or where the API is hosted, with the `SELLER_*`
settings in `api/.env`.

1. **Sandbox** (no OTP needed): `npm run zatca:onboard -- --mode sandbox`. It
   makes a key and a certificate request, gets a compliance certificate, sends
   a standard invoice, a credit note and a debit note through ZATCA's
   compliance checks, and gets a certificate. Any refusal is printed with
   ZATCA's reasons. Talos does not sign standard invoices (ZATCA stamps them at
   clearance); if ZATCA's checks ask for a signature, this is where it shows.
2. **Simulation:** in the Fatoora simulation portal, make an OTP, then
   `npm run zatca:onboard -- --mode simulation --otp <6 digits>`. Run the API
   with `ZATCA_MODE=simulation` and the printed token and secret, and pay once
   with a test card: the invoice must come back cleared.
3. **Production:** when Talos's wave for e-invoicing integration is announced
   (or earlier, if Sal chooses), make an OTP in the Fatoora portal
   (fatoora.zatca.gov.sa), run `npm run zatca:onboard -- --mode core --otp <6 digits>`
   on the production machine, put `ZATCA_CSID_TOKEN`, `ZATCA_CSID_SECRET` and
   the private key in the secret manager, and set `ZATCA_MODE=core`.

The certificate expires; ZATCA's portal says when. Renewing is the same
script with a new OTP.

## Checks

- `api/test/invoices.test.ts`: the XML against a real canonicaliser and
  (when ZATCA's schema files are on the machine) the UBL 2.1 schema, the
  chain under several workers, clearance, refusals, outages, credit notes,
  tenant isolation, the Fatoora client against a local stand-in.
- `dev/checks.sql` check 17: the chain and the guards in the database.
- Still to do with ZATCA itself: ZATCA's business rules checker (the SDK's
  `fatoora -validate`, or the sandbox) on a real document, in 7.8b.
