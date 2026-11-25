-- =====================================================================
-- 0010: sign-up and onboarding (step 7.5)
--
-- A company signs up on its own (Sal, 25 November 2026): it chooses one of
-- the three plans and monthly or yearly, gets a 14-day free trial with no
-- card, accepts the terms of use, and then sets itself up step by step.
-- Talos sends nothing to its debtors until the needed steps are done
-- (company, owner, signed authorization letter).
--
-- 1. app.clients: the new plans, billing period and state, the trial, the
--    terms the company accepted, the first 10 companies' offer, and two
--    onboarding steps that have no data of their own.
-- 2. app.setup_missing(): which needed steps a company has not done yet.
-- 3. app.client_messaging_block(): why Talos may not message a company's
--    debtors right now, or null. The scheduler and every send use it.
-- 4. auth.sign_up(): the only door to create a company, its owner and the
--    owner's password, before anyone is signed in.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plans, billing and onboarding on app.clients
-- ---------------------------------------------------------------------

-- The old plan names were placeholders; no real client has used them.
ALTER TABLE app.clients DROP CONSTRAINT clients_plan_check;
UPDATE app.clients
   SET plan = CASE plan WHEN 'starter' THEN 'follow_up' WHEN 'pro' THEN 'najiz' ELSE 'legal' END;

ALTER TABLE app.clients
  ALTER COLUMN plan SET DEFAULT 'legal',
  ADD CONSTRAINT clients_plan_check CHECK (plan IN ('follow_up', 'legal', 'najiz')),
  ADD COLUMN billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'yearly')),
  -- trial: free until trial_ends_at. active: paid (7.6). unpaid: a payment failed or the
  -- trial ended without a card; Talos stops at once (Sal, 25 November 2026).
  -- Companies that existed before sign-up (none are real) count as paid.
  ADD COLUMN billing_status text NOT NULL DEFAULT 'active' CHECK (billing_status IN ('trial', 'active', 'unpaid')),
  ADD COLUMN trial_ends_at timestamptz,
  -- One of the first 10 companies: first month free (the offer on the website).
  ADD COLUMN founding_member boolean NOT NULL DEFAULT false,
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  -- Onboarding steps with no data of their own: the follow-up rules were kept as they
  -- are, and "I will add debtors later".
  ADD COLUMN setup_rules_at timestamptz,
  ADD COLUMN setup_debtors_later_at timestamptz,
  ADD CONSTRAINT clients_trial_has_end CHECK (billing_status <> 'trial' OR trial_ends_at IS NOT NULL),
  ADD CONSTRAINT clients_terms_pair CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));

-- New companies start on the 14-day trial.
ALTER TABLE app.clients
  ALTER COLUMN billing_status SET DEFAULT 'trial',
  ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '14 days';

-- ---------------------------------------------------------------------
-- 2. Which needed setup steps are still missing
-- ---------------------------------------------------------------------

-- In the order the setup page shows them. RLS applies: the API calls it for its own client.
CREATE FUNCTION app.setup_missing(p_client uuid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT array_remove(ARRAY[
           CASE WHEN c.unified_number IS NULL
                  OR NOT EXISTS (SELECT 1 FROM app.documents d
                                  WHERE d.client_id = c.id AND d.doc_type = 'cr' AND d.debtor_id IS NULL)
                THEN 'company' END,
           CASE WHEN c.owner_id_number IS NULL THEN 'owner' END,
           CASE WHEN c.authorization_signed_at IS NULL THEN 'authorization' END
         ], NULL)
    FROM app.clients c
   WHERE c.id = p_client
$$;

-- ---------------------------------------------------------------------
-- 3. May Talos message this company's debtors now?
-- ---------------------------------------------------------------------

-- Null when it may; otherwise the reason, as a code the dashboard explains.
CREATE FUNCTION app.client_messaging_block(p_client uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
           WHEN c.status = 'onboarding'                                    THEN 'setup_not_finished'
           WHEN c.status <> 'active'                                       THEN 'account_not_active'
           WHEN c.authorization_signed_at IS NULL                          THEN 'no_authorization'
           WHEN c.billing_status = 'unpaid'                                THEN 'payment_needed'
           WHEN c.billing_status = 'trial' AND c.trial_ends_at <= now()    THEN 'trial_ended'
         END
    FROM app.clients c
   WHERE c.id = p_client
$$;

GRANT EXECUTE ON FUNCTION app.setup_missing(uuid), app.client_messaging_block(uuid) TO talos_app, talos_worker;

-- ---------------------------------------------------------------------
-- 4. Sign-up
-- ---------------------------------------------------------------------

-- Creates the company (onboarding, on the trial), its owner with the password the API
-- hashed, and the default follow-up rules, in one step. Refuses a company or an email
-- that already has an account with its own error code, so the API can say so:
--   TL001 company_exists, TL002 email_taken.
-- The first p_founding_limit companies (when p_founding_limit > 0) are founding members.
CREATE FUNCTION auth.sign_up(
  p_full_name text, p_phone text, p_email citext, p_password_hash text,
  p_legal_name text, p_cr_number text, p_plan text, p_period text,
  p_terms_version text, p_trial_days int, p_founding_limit int)
RETURNS TABLE (client_id uuid, user_id uuid, trial_ends_at timestamptz, founding_member boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_client uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_ends   timestamptz := now() + make_interval(days => p_trial_days);
  v_found  boolean := false;
BEGIN
  IF p_trial_days NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'trial days out of range'; END IF;
  IF EXISTS (SELECT 1 FROM app.clients WHERE cr_number = p_cr_number) THEN
    RAISE EXCEPTION 'company_exists' USING ERRCODE = 'TL001';
  END IF;
  IF EXISTS (SELECT 1 FROM app.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = 'TL002';
  END IF;

  -- Count the founding members one sign-up at a time.
  IF p_founding_limit > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('talos.founding_members'));
    v_found := (SELECT count(*) FROM app.clients WHERE app.clients.founding_member) < p_founding_limit;
  END IF;

  PERFORM set_config('app.actor_type', 'user', true);
  PERFORM set_config('app.client_id', v_client::text, true);

  BEGIN
    INSERT INTO app.clients (id, legal_name, cr_number, owner_name, owner_phone, owner_email,
                             plan, billing_period, billing_status, trial_ends_at, founding_member,
                             terms_version, terms_accepted_at, sender_number_id, status)
    VALUES (v_client, p_legal_name, p_cr_number, p_full_name, p_phone, p_email,
            p_plan, p_period, 'trial', v_ends, v_found, p_terms_version, now(),
            (SELECT id FROM app.sender_numbers WHERE is_shared AND status = 'active' ORDER BY created_at LIMIT 1),
            'onboarding');
    INSERT INTO app.users (id, client_id, full_name, email, phone, role)
    VALUES (v_user, v_client, p_full_name, p_email, p_phone, 'owner');
  EXCEPTION WHEN unique_violation THEN
    -- Two sign-ups at the same moment: the second one is told the same as above.
    IF EXISTS (SELECT 1 FROM app.clients WHERE cr_number = p_cr_number AND id <> v_client) THEN
      RAISE EXCEPTION 'company_exists' USING ERRCODE = 'TL001';
    END IF;
    RAISE EXCEPTION 'email_taken' USING ERRCODE = 'TL002';
  END;

  PERFORM set_config('app.user_id', v_user::text, true);
  INSERT INTO auth.credentials (user_id, password_hash) VALUES (v_user, p_password_hash);
  INSERT INTO app.follow_up_rules (client_id) VALUES (v_client);
  INSERT INTO audit.activity_log (client_id, actor_type, actor_id, action, target_table, target_id, details)
  VALUES (v_client, 'user', v_user, 'auth.sign_up', 'app.clients', v_client,
          jsonb_build_object('plan', p_plan, 'period', p_period, 'terms_version', p_terms_version,
                             'trial_ends_at', v_ends, 'founding_member', v_found));

  RETURN QUERY SELECT v_client, v_user, v_ends, v_found;
END $$;

REVOKE ALL ON FUNCTION auth.sign_up(text, text, citext, text, text, text, text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.sign_up(text, text, citext, text, text, text, text, text, text, int, int) TO talos_app;
