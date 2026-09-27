// Shared with the Node cleanup command; no app aliases or runtime dependencies.
export const cleanupLeadsSql = `
WITH expired AS (
  UPDATE acquisition_leads SET email = NULL, status = 'withdrawn',
    consent_version = NULL, consent_text = NULL, consent_at = NULL, snapshot = NULL,
    confirmed_at = NULL, confirm_hash = NULL, confirm_expires_at = NULL,
    withdraw_hash = NULL, sent_at = NULL, user_id = NULL, linked_at = NULL
  WHERE status <> 'withdrawn' AND expires_at <= $1 RETURNING id
), cleared_sources AS (
  UPDATE user_attribution SET snapshot = NULL, lead_id = NULL, withdrawn_at = $1
  WHERE lead_id IN (SELECT id FROM expired)
)
SELECT count(*)::int AS cleared FROM expired`;
