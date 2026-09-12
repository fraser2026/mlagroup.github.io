/* RegAnchor MCP: device approve, portal connect, OAuth consent. */

function mcpAuthHeaders(session) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + session.access_token,
    apikey: SUPABASE_KEY,
  };
}

function mcpSnippetForClient(client, accessToken, mcpUrl) {
  var server = {
    url: mcpUrl,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      apikey: SUPABASE_KEY,
    },
  };
  if (client === 'codex') {
    return JSON.stringify(
      {
        mcpServers: {
          reganchor: server,
        },
      },
      null,
      2,
    ) + '\n\n# Add under Codex MCP / tools config (host-specific path).\n# Do not commit this file. Access tokens expire in one hour.';
  }
  if (client === 'claude-desktop') {
    return JSON.stringify(
      {
        mcpServers: {
          reganchor: server,
        },
      },
      null,
      2,
    ) + '\n\n# Claude Desktop: merge into claude_desktop_config.json under mcpServers.\n# Prefer remote URL hosts; stdio adapter is optional.';
  }
  return JSON.stringify(
    {
      mcpServers: {
        reganchor: server,
      },
    },
    null,
    2,
  ) + '\n\n# Cursor: merge under .cursor/mcp.json → mcpServers (one root object).\n# Do not click Authenticate when using this Bearer header.\n# For marketplace OAuth later, add the server URL only and use Authenticate.';
}

function prepareMcpDevicePage(hashFragment) {
  var input = document.getElementById('mcp-device-code');
  var err = document.getElementById('mcp-device-error');
  var ok = document.getElementById('mcp-device-ok');
  if (err) {
    err.textContent = '';
    err.classList.remove('is-visible');
  }
  if (ok) ok.style.display = 'none';
  if (!input) return;
  var code = '';
  var raw = String(hashFragment || '');
  var qIndex = raw.indexOf('?');
  if (qIndex >= 0) {
    var params = new URLSearchParams(raw.slice(qIndex + 1));
    code = String(params.get('code') || '').trim().toUpperCase();
  }
  if (!code) {
    try {
      var urlParams = new URLSearchParams(window.location.search);
      code = String(urlParams.get('code') || urlParams.get('mcp_code') || '')
        .trim()
        .toUpperCase();
    } catch (e) {}
  }
  if (code) input.value = code;
  input.focus();
}

async function approveMcpDeviceLogin() {
  var input = document.getElementById('mcp-device-code');
  var err = document.getElementById('mcp-device-error');
  var ok = document.getElementById('mcp-device-ok');
  var btn = document.getElementById('mcp-device-approve-btn');
  var userCode = String((input && input.value) || '')
    .trim()
    .toUpperCase();
  if (err) {
    err.textContent = '';
    err.classList.remove('is-visible');
  }
  if (ok) ok.style.display = 'none';
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
    if (err) {
      err.textContent = 'Enter the code in the form ABCD-EFGH.';
      err.classList.add('is-visible');
    }
    return;
  }
  try {
    if (!currentOrg && typeof ensureOrg === 'function') await ensureOrg();
    var sd = await sb.auth.getSession();
    var session = sd.data.session;
    if (!session) throw new Error('Sign in required.');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Approving…';
    }
    var res = await fetch(SUPABASE_URL + '/functions/v1/mcp-auth', {
      method: 'POST',
      headers: mcpAuthHeaders(session),
      body: JSON.stringify({
        action: 'device_approve',
        user_code: userCode,
        org_id: currentOrg && currentOrg.id ? currentOrg.id : undefined,
      }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || 'Could not approve device login.');
    if (ok) ok.style.display = 'block';
    if (input) input.value = '';
  } catch (e) {
    if (err) {
      err.textContent = e.message || 'Could not approve device login.';
      err.classList.add('is-visible');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Approve';
    }
  }
}

async function issueMcpPortalConnect() {
  var err = document.getElementById('mcp-connect-error');
  var result = document.getElementById('mcp-connect-result');
  var snippet = document.getElementById('mcp-connect-snippet');
  var btn = document.getElementById('mcp-connect-issue-btn');
  var clientEl = document.getElementById('mcp-connect-client');
  var client = (clientEl && clientEl.value) || 'cursor';
  if (err) {
    err.textContent = '';
    err.classList.remove('is-visible');
  }
  if (result) result.style.display = 'none';
  try {
    if (!currentOrg && typeof ensureOrg === 'function') await ensureOrg();
    var sd = await sb.auth.getSession();
    var session = sd.data.session;
    if (!session) throw new Error('Sign in required.');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Connecting…';
    }
    var res = await fetch(SUPABASE_URL + '/functions/v1/mcp-auth', {
      method: 'POST',
      headers: mcpAuthHeaders(session),
      body: JSON.stringify({
        action: 'portal_issue',
        client_name: client,
        label: 'Portal connect (' + client + ')',
        org_id: currentOrg && currentOrg.id ? currentOrg.id : undefined,
      }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.access_token) throw new Error(data.error || 'Could not issue MCP token.');
    var mcpUrl = SUPABASE_URL + '/functions/v1/mcp';
    if (snippet) snippet.value = mcpSnippetForClient(client, data.access_token, mcpUrl);
    if (result) result.style.display = 'block';
    loadMcpSessions();
  } catch (e) {
    if (err) {
      err.textContent = e.message || 'Could not connect MCP.';
      err.classList.add('is-visible');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Connect';
    }
  }
}

function copyMcpConnectSnippet() {
  var snippet = document.getElementById('mcp-connect-snippet');
  if (!snippet || !snippet.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(snippet.value).catch(function () {
      snippet.select();
      document.execCommand('copy');
    });
  } else {
    snippet.select();
    document.execCommand('copy');
  }
}

async function loadMcpSessions() {
  var list = document.getElementById('mcp-sessions-list');
  if (!list) return;
  list.textContent = 'Loading…';
  try {
    var sd = await sb.auth.getSession();
    var session = sd.data.session;
    if (!session) {
      list.textContent = 'Sign in to see sessions.';
      return;
    }
    var res = await fetch(SUPABASE_URL + '/functions/v1/mcp-auth', {
      method: 'POST',
      headers: mcpAuthHeaders(session),
      body: JSON.stringify({ action: 'sessions_list' }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || 'Could not load sessions.');
    var rows = data.sessions || [];
    if (!rows.length) {
      list.textContent = 'No MCP sessions yet.';
      return;
    }
    list.innerHTML = rows
      .map(function (s) {
        var active = !s.revoked_at;
        var when = s.last_used_at || s.created_at || '';
        var label = (s.label || s.client_name || 'MCP').replace(/</g, '&lt;');
        var status = active ? 'Active' : 'Revoked';
        var btn = active
          ? '<button type="button" class="btn-topbar btn-topbar-ghost" style="margin-left:8px;" onclick="revokeMcpSession(\'' +
            s.id +
            '\')">Revoke</button>'
          : '';
        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--ra-border);">' +
          '<div><div style="color:var(--ra-text);">' +
          label +
          '</div><div style="font-size:12px;color:var(--ra-text-2);">' +
          status +
          (when ? ' · ' + when : '') +
          '</div></div>' +
          btn +
          '</div>'
        );
      })
      .join('');
  } catch (e) {
    list.textContent = e.message || 'Could not load sessions.';
  }
}

async function revokeMcpSession(sessionId) {
  try {
    var sd = await sb.auth.getSession();
    var session = sd.data.session;
    if (!session) throw new Error('Sign in required.');
    var res = await fetch(SUPABASE_URL + '/functions/v1/mcp-auth', {
      method: 'POST',
      headers: mcpAuthHeaders(session),
      body: JSON.stringify({ action: 'revoke_session', session_id: sessionId }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || 'Could not revoke session.');
    loadMcpSessions();
  } catch (e) {
    var err = document.getElementById('mcp-connect-error');
    if (err) {
      err.textContent = e.message || 'Could not revoke session.';
      err.classList.add('is-visible');
    }
  }
}

var _mcpOAuthParams = null;

function openMcpOAuthModal() {
  var modal = document.getElementById('mcp-oauth-modal');
  if (modal) modal.classList.add('open');
}

function closeMcpOAuthModal() {
  var modal = document.getElementById('mcp-oauth-modal');
  if (modal) modal.classList.remove('open');
}

function prepareMcpOAuthPage(hashFragment) {
  var err = document.getElementById('mcp-oauth-error');
  if (err) {
    err.textContent = '';
    err.classList.remove('is-visible');
  }
  _mcpOAuthParams = null;
  var params = null;
  var raw = String(hashFragment || '');
  var qIndex = raw.indexOf('?');
  if (qIndex >= 0) {
    params = new URLSearchParams(raw.slice(qIndex + 1));
  } else {
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      params = new URLSearchParams();
    }
  }
  if (!params.get('client_id')) return;
  _mcpOAuthParams = {
    client_id: String(params.get('client_id') || ''),
    redirect_uri: String(params.get('redirect_uri') || ''),
    code_challenge: String(params.get('code_challenge') || ''),
    code_challenge_method: String(params.get('code_challenge_method') || 'S256'),
    state: String(params.get('state') || ''),
    resource: String(params.get('resource') || ''),
    scope: String(params.get('scope') || 'mcp:tools'),
    client_name: String(params.get('client_name') || 'MCP client'),
  };
  var nameEl = document.getElementById('mcp-oauth-client-name');
  if (nameEl) nameEl.textContent = _mcpOAuthParams.client_name;
  openMcpOAuthModal();
}

async function consentMcpOAuth(deny) {
  var err = document.getElementById('mcp-oauth-error');
  var allowBtn = document.getElementById('mcp-oauth-allow-btn');
  var denyBtn = document.getElementById('mcp-oauth-deny-btn');
  if (err) {
    err.textContent = '';
    err.classList.remove('is-visible');
  }
  if (!_mcpOAuthParams || !_mcpOAuthParams.client_id) {
    if (err) {
      err.textContent = 'Missing OAuth request. Open the link from your MCP host again.';
      err.classList.add('is-visible');
    }
    return;
  }
  try {
    if (!currentOrg && typeof ensureOrg === 'function') await ensureOrg();
    var sd = await sb.auth.getSession();
    var session = sd.data.session;
    if (!session) throw new Error('Sign in required.');
    if (allowBtn) {
      allowBtn.disabled = true;
      allowBtn.textContent = deny ? 'Allow' : 'Allowing…';
    }
    if (denyBtn) denyBtn.disabled = true;
    var res = await fetch(SUPABASE_URL + '/functions/v1/mcp-oauth/consent', {
      method: 'POST',
      headers: mcpAuthHeaders(session),
      body: JSON.stringify({
        client_id: _mcpOAuthParams.client_id,
        redirect_uri: _mcpOAuthParams.redirect_uri,
        code_challenge: _mcpOAuthParams.code_challenge,
        state: _mcpOAuthParams.state,
        resource: _mcpOAuthParams.resource,
        scope: _mcpOAuthParams.scope,
        org_id: currentOrg && currentOrg.id ? currentOrg.id : undefined,
        deny: !!deny,
      }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.redirect_to) {
      throw new Error(data.error_description || data.error || 'Consent failed.');
    }
    closeMcpOAuthModal();
    window.location.href = data.redirect_to;
  } catch (e) {
    if (err) {
      err.textContent = e.message || 'Consent failed.';
      err.classList.add('is-visible');
    }
  } finally {
    if (allowBtn) {
      allowBtn.disabled = false;
      allowBtn.textContent = 'Allow';
    }
    if (denyBtn) denyBtn.disabled = false;
  }
}
