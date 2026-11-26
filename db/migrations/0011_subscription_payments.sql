-- =====================================================================
-- 0011: subscription payments (step 7.6)
--
-- Companies pay Talos by card through the payment provider (Moyasar,
-- approved by Sal on 26 November 2026). The card number never reaches
-- Talos: the browser sends it straight to the provider, which gives back a
-- token. Talos keeps the token, the card type, its last four digits and its
-- expiry, and charges the token at the end of the trial and of every period.
--
-- 1. app.clients: the paid period, the next charge, cancelling, and which
--    notices were sent. 'cancelled' joins the billing states. Only the
--    system may change the billing state (a trigger checks it).
-- 2. app.billing_cards: the saved cards (one active per company).
-- 3. app.billing_charges: every charge, one row per try. Its id is sent to
--    the provider as the idempotency key, so a charge retried after a crash
--    is never taken twice.
-- 4. app.client_messaging_block(): the founding members' free month, and a
--    subscription that has ended.
--
-- Decisions (Sal, 25 and 26 November 2026): a failed payment stops messages
-- and Najiz filing at once; the card is tried again after 1 and 3 days; the
-- first 10 companies get their first month after the trial free.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Billing on app.clients
-- ---------------------------------------------------------------------

ALTER TABLE app.clients DROP CONSTRAINT clients_billing_status_check;
ALTER TABLE app.clients
  -- cancelled: the owner cancelled and the period they paid for has ended.
  ADD CONSTRAINT clients_billing_status_check CHECK (billing_status IN ('trial', 'active', 'unpaid', 'cancelled')),
  -- End of the period paid for. Null for companies that existed before payments (none are real).
  ADD COLUMN paid_until timestamptz,
  -- When the card is tried again after a failed payment. Null: no automatic try is planned.
  ADD COLUMN next_charge_at timestamptz,
  -- The owner cancelled: nothing more is charged, and the service ends with the period.
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at timestamptz,
  -- Notices already sent, so each goes out once.
  ADD COLUMN trial_notice_at timestamptz,         -- "your trial ends in 3 days", no card yet
  ADD COLUMN trial_ended_notice_at timestamptz,   -- "your trial has ended", no card
  ADD COLUMN renewal_notice_for timestamptz,      -- yearly plans: the paid_until it was sent for
  ADD CONSTRAINT clients_cancelled_has_date CHECK ((billing_status = 'cancelled') = (cancelled_at IS NOT NULL));

-- When the free time ends: the trial, plus one month for founding members.
CREATE FUNCTION app.free_until(p_trial_ends_at timestamptz, p_founding boolean) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_trial_ends_at + CASE WHEN p_founding THEN interval '1 month' ELSE interval '0' END
$$;
GRANT EXECUTE ON FUNCTION app.free_until(timestamptz, boolean) TO talos_app, talos_worker;

-- The API (talos_app) may change the billing state only as the system, after
-- the payment provider has confirmed a payment. Staff may cancel and undo it.
CREATE FUNCTION app.clients_billing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.billing_status, NEW.billing_period, NEW.trial_ends_at, NEW.founding_member, NEW.paid_until,
      NEW.next_charge_at, NEW.cancelled_at, NEW.trial_notice_at, NEW.trial_ended_notice_at, NEW.renewal_notice_for)
     IS DISTINCT FROM
     (OLD.billing_status, OLD.billing_period, OLD.trial_ends_at, OLD.founding_member, OLD.paid_until,
      OLD.next_charge_at, OLD.cancelled_at, OLD.trial_notice_at, OLD.trial_ended_notice_at, OLD.renewal_notice_for)
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND pg_has_role(current_user, 'talos_app', 'MEMBER')
     AND coalesce(current_setting('app.actor_type', true), '') <> 'system'
  THEN
    RAISE EXCEPTION 'billing details are changed only by the system' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER clients_billing_guard BEFORE UPDATE ON app.clients
  FOR EACH ROW EXECUTE FUNCTION app.clients_billing_guard();

-- ---------------------------------------------------------------------
-- 2. Saved cards
-- ---------------------------------------------------------------------

-- Never the card number. The token is useless without Talos's secret key;
-- the API never sends it to the browser. No generic audit trigger here, so
-- the token never lands in the audit log: the API writes its own lines.
CREATE TABLE app.billing_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES app.clients(id) ON DELETE CASCADE,
  gateway       text NOT NULL CHECK (gateway IN ('moyasar', 'fake')),
  token         text NOT NULL CHECK (token ~ '^token_[A-Za-z0-9_]{6,100}$'),
  -- pending: the cardholder is confirming it with their bank (3D Secure).
  -- failed: the bank or the provider refused it. removed: replaced by a newer card.
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed', 'removed')),
  brand         text CHECK (brand ~ '^[a-z_]{2,20}$'),
  last_four     text CHECK (last_four ~ '^[0-9]{4}$'),
  exp_month     int CHECK (exp_month BETWEEN 1 AND 12),
  exp_year      int CHECK (exp_year BETWEEN 2000 AND 2200),
  added_by      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  activated_at  timestamptz,
  removed_at    timestamptz,
  UNIQUE (client_id, id),
  UNIQUE (gateway, token),
  FOREIGN KEY (client_id, added_by) REFERENCES app.users (client_id, id),
  CHECK (status <> 'active' OR (last_four IS NOT NULL AND activated_at IS NOT NULL)),
  CHECK ((status = 'removed') = (removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX billing_cards_one_active ON app.billing_cards (client_id) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 3. Charges
-- ---------------------------------------------------------------------

CREATE TABLE app.billing_charges (
  -- Also the provider's idempotency key (given_id): the same id never charges twice.
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES app.clients(id) ON DELETE CASCADE,
  card_id             uuid NOT NULL,
  -- trial_end: first payment. renewal: next period. retry: after a failed payment. pay_now: staff pressed pay.
  reason              text NOT NULL CHECK (reason IN ('trial_end', 'renewal', 'retry', 'pay_now')),
  plan                text NOT NULL CHECK (plan IN ('follow_up', 'legal', 'najiz')),
  billing_period      text NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  -- What the card is charged, with the value added tax inside it.
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  vat_amount          numeric(12,2) NOT NULL CHECK (vat_amount >= 0 AND vat_amount < amount),
  currency            text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL CHECK (period_end > period_start),
  -- sending: asked the provider and waiting for its answer (or Talos stopped half way).
  status              text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'paid', 'failed')),
  gateway_payment_id  text UNIQUE,
  failure_code        text,
  failure_message     text,             -- the provider's words, for staff
  requested_by        uuid,             -- the person who pressed pay; null when the system charged
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, card_id) REFERENCES app.billing_cards (client_id, id),
  FOREIGN KEY (client_id, requested_by) REFERENCES app.users (client_id, id),
  CHECK ((status = 'sending') = (finished_at IS NULL)),
  CHECK (status <> 'paid' OR gateway_payment_id IS NOT NULL)
);
-- One charge at a time per company: two workers, or a worker and a person, never charge together.
CREATE UNIQUE INDEX billing_charges_one_sending ON app.billing_charges (client_id) WHERE status = 'sending';
CREATE INDEX billing_charges_by_client ON app.billing_charges (client_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_cards', 'billing_charges']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I
                    USING (client_id = app.current_client_id())
                    WITH CHECK (client_id = app.current_client_id())', t);
    -- Every table with RLS also needs the worker policy (see 0003).
    EXECUTE format('CREATE POLICY worker_all ON app.%I TO talos_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO talos_app, talos_worker', t);
  END LOOP;
END $$;

CREATE TRIGGER billing_charges_audit AFTER INSERT OR UPDATE OR DELETE ON app.billing_charges
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- ---------------------------------------------------------------------
-- 4. May Talos message this company's debtors now?
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.client_messaging_block(p_client uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
           WHEN c.status = 'onboarding'                                    THEN 'setup_not_finished'
           WHEN c.status <> 'active'                                       THEN 'account_not_active'
           WHEN c.authorization_signed_at IS NULL                          THEN 'no_authorization'
           WHEN c.billing_status = 'unpaid'                                THEN 'payment_needed'
           WHEN c.billing_status = 'cancelled'
             OR (c.cancel_at_period_end AND c.billing_status = 'active' AND c.paid_until <= now())
                                                                           THEN 'subscription_ended'
           WHEN c.billing_status = 'trial'
            AND app.free_until(c.trial_ends_at, c.founding_member) <= now() THEN 'trial_ended'
         END
    FROM app.clients c
   WHERE c.id = p_client
$$;
