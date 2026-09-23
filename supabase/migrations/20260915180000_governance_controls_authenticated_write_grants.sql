-- Control Centre writes need table GRANTs as well as RLS policies.
-- RLS alone is not enough: without UPDATE privilege, publishes fail.

grant select, insert, update, delete on public.governance_controls to authenticated;
grant select, insert, update, delete on public.compliance_frameworks to authenticated;
