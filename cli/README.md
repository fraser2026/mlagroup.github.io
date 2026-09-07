# RegAnchor developer CLI

Use `ra` to connect and verify an AI asset from the commands shown on its
Connection tab. Node.js current LTS (20+) is recommended; 18+ works. The CLI
has no package dependencies.

## Configure authentication

The CLI calls authenticated Supabase Edge Functions as the signed-in user.
Use the public anon key and a current user access token; never use a service
role key.

PowerShell:

```powershell
$env:REGANCHOR_ANON_KEY = "<Supabase anon key>"
$env:REGANCHOR_ACCESS_TOKEN = "<signed-in user JWT>"
$env:REGANCHOR_SUPABASE_URL = "https://hueftewwenjaiagdoqmb.supabase.co"
```

POSIX:

```sh
export REGANCHOR_ANON_KEY="<Supabase anon key>"
export REGANCHOR_ACCESS_TOKEN="<signed-in user JWT>"
export REGANCHOR_SUPABASE_URL="https://hueftewwenjaiagdoqmb.supabase.co"
```

`REGANCHOR_SUPABASE_URL` is optional and defaults to the hosted RegAnchor
project. `REGANCHOR_URL` is accepted as a compatibility fallback. Access
tokens expire, so replace `REGANCHOR_ACCESS_TOKEN` with a fresh user JWT when
Supabase returns `401`.

## Run from this repository

Copy the asset-specific commands from Registry → asset → Connection → CLI.

PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "<runtime key>"
.\cli\ra.ps1 connect --asset <uuid> --provider anthropic --key $env:ANTHROPIC_API_KEY
.\cli\ra.ps1 check --asset <uuid>
.\cli\ra.ps1 smoke --asset <uuid>
.\cli\ra.ps1 insights --asset <uuid> --days 30
```

POSIX:

```sh
export ANTHROPIC_API_KEY="<runtime key>"
./cli/ra connect --asset <uuid> --provider anthropic --key "$ANTHROPIC_API_KEY"
./cli/ra check --asset <uuid>
./cli/ra smoke --asset <uuid>
./cli/ra insights --asset <uuid> --days 30
```

Avoid placing a literal provider key in shell history. The `connect` command
verifies the runtime key before RegAnchor stores it encrypted in Vault.

`smoke` currently runs the same live stored-credential and capability probe as
`check`; it does not send an Anthropic Messages request. On success it prints
the next step for sending a tiny request from your application with the same
runtime key.

## Install the `ra` command locally

From `cli/`, run:

```sh
npm link
ra --help
```

Commands use the permissions of the user represented by
`REGANCHOR_ACCESS_TOKEN`. Connecting a key and refreshing insights require an
organisation owner or admin; checking a connection requires organisation
membership.
