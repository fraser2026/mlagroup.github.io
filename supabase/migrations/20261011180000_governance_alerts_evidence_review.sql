alter table public.governance_alerts drop constraint governance_alerts_alert_type_check;
alter table public.governance_alerts add constraint governance_alerts_alert_type_check check (alert_type = any (array[
  'score_drop','control_overdue','assessment_due','control_regression','compliance_rule_fired',
  'support_response','task_assigned','task_overdue','policy_requires_ack','evidence_review'
]));
