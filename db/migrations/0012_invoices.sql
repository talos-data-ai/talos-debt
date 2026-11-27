-- =====================================================================
-- 0012: Talos's own tax invoices to its clients (step 7.8)
--
-- Every paid subscription charge gets a tax invoice that meets ZATCA's
-- e-invoicing rules (Fatoora): a UBL 2.1 XML document with a unique UUID,
-- an invoice counter (ICV) that never skips a number, and the hash of the
-- previous invoice (PIH), so the invoices form one unbroken chain. Talos's
-- clients are companies, so these are standard tax invoices: sent to ZATCA
-- for clearance and stamped by ZATCA before the client gets them. A refund
-- gets a credit note in the same chain.
--
-- 1. app.clients: the national address printed on the client's invoices.
-- 2. app.invoice_chain: the last counter and hash. Talos is one seller, so
--    the chain is shared by all clients; the API reaches it only through two
--    functions, and taking the next link locks it until the invoice is saved.
-- 3. app.invoices: the documents. What was issued never changes; only the
--    answer from ZATCA is added. Kept when a client is deleted (tax records).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The client's national address, for its invoices (BR-KSA-63)
-- ---------------------------------------------------------------------

ALTER TABLE app.clients
  ADD COLUMN address_building text CHECK (address_building ~ '^[0-9]{4}$'),
  ADD COLUMN address_street   text CHECK (length(address_street) BETWEEN 1 AND 200),
  ADD COLUMN address_district text CHECK (length(address_district) BETWEEN 1 AND 127),
  ADD COLUMN address_city     text CHECK (length(address_city) BETWEEN 1 AND 127),
  ADD COLUMN address_postal   text CHECK (address_postal ~ '^[0-9]{5}$'),
  -- A VAT number has 15 digits and starts and ends with 3 (BR-KSA-44).
  ADD CONSTRAINT clients_vat_number_format CHECK (vat_number IS NULL OR vat_number ~ '^3[0-9]{13}3$') NOT VALID;

-- ---------------------------------------------------------------------
-- 2. The chain
-- ---------------------------------------------------------------------

CREATE TABLE app.invoice_chain (
  id         int PRIMARY KEY CHECK (id = 1),
  last_icv   bigint NOT NULL CHECK (last_icv >= 0),
  -- base64 of the SHA-256 of the last invoice; before the first one, of "0" (ZATCA's rule).
  last_hash  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.invoice_chain (id, last_icv, last_hash)
VALUES (1, 0, 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==');
REVOKE ALL ON app.invoice_chain FROM PUBLIC, talos_app, talos_worker;

-- The next counter and the hash before it. Locks the chain until the transaction ends,
-- so two invoices can never get the same counter and none is skipped.
CREATE FUNCTION app.invoice_chain_next() RETURNS TABLE (icv bigint, pih text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.last_icv + 1, c.last_hash FROM app.invoice_chain c WHERE c.id = 1 FOR UPDATE
$$;

-- Records the invoice just made, in the same transaction. Refuses anything but the next counter.
CREATE FUNCTION app.invoice_chain_save(p_icv bigint, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_hash !~ '^[A-Za-z0-9+/]{43}=$' THEN RAISE EXCEPTION 'invoice hash must be base64 SHA-256'; END IF;
  UPDATE app.invoice_chain SET last_icv = p_icv, last_hash = p_hash, updated_at = now()
   WHERE id = 1 AND last_icv = p_icv - 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice counter % is not the next one', p_icv; END IF;
END $$;

REVOKE ALL ON FUNCTION app.invoice_chain_next(), app.invoice_chain_save(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invoice_chain_next(), app.invoice_chain_save(bigint, text) TO talos_app, talos_worker;

-- ---------------------------------------------------------------------
-- 3. Invoices and credit notes
-- ---------------------------------------------------------------------

CREATE TABLE app.invoices (
  id               uuid PRIMARY KEY,                 -- the invoice's UUID in the XML (KSA-1)
  client_id        uuid NOT NULL REFERENCES app.clients(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  number           text NOT NULL UNIQUE,             -- printed number, from the counter
  icv              bigint NOT NULL UNIQUE CHECK (icv > 0),
  pih              text NOT NULL,
  invoice_hash     text NOT NULL,
  charge_id        uuid,                             -- the payment it is for
  original_id      uuid,                             -- a credit note: the invoice it corrects
  reason           text CHECK (length(reason) BETWEEN 1 AND 1000),
  issued_at        timestamptz NOT NULL,
  supply_start     date NOT NULL,
  supply_end       date NOT NULL CHECK (supply_end >= supply_start),
  net_amount       numeric(12,2) NOT NULL CHECK (net_amount > 0),
  vat_amount       numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
  total_amount     numeric(12,2) NOT NULL CHECK (total_amount = net_amount + vat_amount),
  buyer            jsonb NOT NULL,                   -- the client's details as printed
  xml              text NOT NULL,                    -- exactly what was hashed and sent
  -- generated: made while Talos is not yet connected to ZATCA (Phase 1).
  -- pending: waiting to be sent (ZATCA could not be reached). cleared: stamped by ZATCA.
  -- rejected: refused by ZATCA; it never reaches the client and staff are told.
  zatca_mode       text NOT NULL CHECK (zatca_mode IN ('off', 'fake', 'sandbox', 'simulation', 'core')),
  status           text NOT NULL CHECK (status IN ('generated', 'pending', 'cleared', 'rejected')),
  cleared_xml      text,
  qr               text,
  zatca_messages   jsonb,
  submit_tries     int NOT NULL DEFAULT 0,
  submitted_at     timestamptz,
  cleared_at       timestamptz,
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, charge_id) REFERENCES app.billing_charges (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, original_id) REFERENCES app.invoices (client_id, id),
  CHECK ((kind = 'credit_note') = (original_id IS NOT NULL)),
  CHECK (kind = 'invoice' OR reason IS NOT NULL),
  CHECK ((status = 'cleared') = (cleared_xml IS NOT NULL AND cleared_at IS NOT NULL))
);
-- One invoice per paid charge (a rejected one may be issued again once the details are fixed).
CREATE UNIQUE INDEX invoices_one_per_charge ON app.invoices (charge_id) WHERE kind = 'invoice' AND status <> 'rejected';
CREATE INDEX invoices_by_client ON app.invoices (client_id, issued_at DESC);
CREATE INDEX invoices_to_send ON app.invoices (issued_at) WHERE status = 'pending';

-- What was issued is a tax record: it never changes. Only ZATCA's answer is added, by the system.
CREATE FUNCTION app.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices are kept as tax records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.client_id, NEW.kind, NEW.number, NEW.icv, NEW.pih, NEW.invoice_hash, NEW.charge_id, NEW.original_id,
      NEW.reason, NEW.issued_at, NEW.supply_start, NEW.supply_end, NEW.net_amount, NEW.vat_amount, NEW.total_amount,
      NEW.buyer, NEW.xml, NEW.zatca_mode)
     IS DISTINCT FROM
     (OLD.id, OLD.client_id, OLD.kind, OLD.number, OLD.icv, OLD.pih, OLD.invoice_hash, OLD.charge_id, OLD.original_id,
      OLD.reason, OLD.issued_at, OLD.supply_start, OLD.supply_end, OLD.net_amount, OLD.vat_amount, OLD.total_amount,
      OLD.buyer, OLD.xml, OLD.zatca_mode) THEN
    RAISE EXCEPTION 'an issued invoice cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only a document waiting for ZATCA changes state: cleared, rejected and generated are final.
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'an invoice that is % stays %', OLD.status, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.cleared_xml IS NOT NULL AND NEW.cleared_xml IS DISTINCT FROM OLD.cleared_xml THEN
    RAISE EXCEPTION 'ZATCA''s cleared invoice cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND pg_has_role(current_user, 'talos_app', 'MEMBER')
     AND coalesce(current_setting('app.actor_type', true), '') <> 'system' THEN
    RAISE EXCEPTION 'invoices are changed only by the system' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_guard();

-- Only the system issues invoices.
CREATE FUNCTION app.invoices_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND pg_has_role(current_user, 'talos_app', 'MEMBER')
     AND coalesce(current_setting('app.actor_type', true), '') <> 'system' THEN
    RAISE EXCEPTION 'invoices are issued only by the system' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_insert_guard BEFORE INSERT ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_insert_guard();

ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.invoices
  USING (client_id = app.current_client_id())
  WITH CHECK (client_id = app.current_client_id());
-- Every table with RLS also needs the worker policy (see 0003).
CREATE POLICY worker_all ON app.invoices TO talos_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON app.invoices TO talos_app, talos_worker;

CREATE TRIGGER invoices_audit AFTER INSERT OR UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();
