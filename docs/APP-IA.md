# App information architecture

## Core product loop

RegAnchor is where an organisation puts **every AI system and agent under control**.

```
Workspace (org)
  ├── Getting started
  ├── Registry (inventory of assets)
  ├── Connect (MCP / IDE + configured integrations)
  └── Governance (Frameworks, Policies, Controls)

Asset (registry detail)
  ├── Overview
  ├── Assessment
  ├── Controls
  ├── Connection
  └── Audit log
```

Primary loop:

1. **Register** an asset in the Registry
2. **Assess** risk and maturity
3. **Assign and close** controls
4. **Connect** a runtime key (and gateway tokens where supported)
5. **Audit** changes over time

Org-level **Connect** feeds developers and agents with MCP and integration credentials. Asset **Connection** holds the runtime key, org admin link, provider usage, and gateway tokens for that asset.

Govern / Build / Operate module chrome is parked for a later phase. Browse / Act / Deep-focus interaction patterns are also future, not current chrome.

## Route map

| Route | Surface |
|---|---|
| `/setup` | Workspace Getting started |
| `/registry` | Asset inventory |
| `/registry/:id` | Asset detail (Overview default) |
| `/registry/:id?tab=overview\|assessment\|controls\|connection\|audit` | Asset detail tab |
| `/integrations` | Org Connect |
| `/frameworks`, `/policies`, `/controls` | Org governance |

## Navigation priority

1. Registry
2. Connect
3. Reports
4. Frameworks / Policies / Controls
5. Getting started (under Workspace)
6. Monitoring / Alerts / Settings

## Still in portal / parked

- Policy e-sign and some assessment write paths may still deep-link to legacy until fully migrated.
- **Dashboard / Home, certificates, maturity posters:** parked. Portal dashboard was never finished. Do not merge that chrome into the app yet. Revisit after Connectors/MCP show what data is real enough to surface on a home.
