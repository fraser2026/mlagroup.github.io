/**
 * RegAnchor public & ops contact surface — single source of truth.
 *
 * Outbound mail: POST to the deployed Supabase Edge Function `send-mail`
 * (gateway verify_jwt off — public forms have no user JWT). From is locked
 * server-side to RegAnchor <info@reganchor.com>. Pass only `kind` + form
 * fields — never a From address or an arbitrary ops To.
 *
 * When a Supabase session exists (portal / admin), the access_token is
 * attached so gated kinds (portal-alert, admin-reply) can auth. Public
 * contact / demo / enterprise / diagnostic kinds work with no token.
 */
(function (global) {
  var INFO = 'info@reganchor.com';
  var SEND_MAIL_URL =
    'https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/send-mail';

  function resolveAccessToken(explicit) {
    if (explicit) return Promise.resolve(explicit);
    try {
      var client = null;
      // Classic scripts share global lexical bindings for const/let (not window.*).
      if (typeof sb !== 'undefined' && sb && sb.auth) client = sb;
      else if (global.sb && global.sb.auth) client = global.sb;
      if (client && typeof client.auth.getSession === 'function') {
        return client.auth.getSession().then(function (res) {
          var session = res && res.data && res.data.session;
          return (session && session.access_token) || null;
        }).catch(function () {
          return null;
        });
      }
    } catch (_e) { /* no session client on public pages */ }
    return Promise.resolve(null);
  }

  /**
   * POST { kind, ...payload } to send-mail.
   * Optional accessToken (3rd arg) forces Authorization Bearer — used by
   * admin.html. Otherwise attaches sb.auth session token when present.
   * Resolves with the JSON body ({ ok, id } or { error }).
   * Rejects on network failure or non-OK HTTP with an Error whose
   * message is the server error string when available.
   */
  function sendMail(kind, payload, accessToken) {
    var body = Object.assign({}, payload || {}, { kind: kind });
    return resolveAccessToken(accessToken).then(function (token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return fetch(SEND_MAIL_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!res.ok || data.error) {
            var err = new Error(
              (data && data.error) || ('Mail failed (' + res.status + ')')
            );
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      });
    });
  }

  global.RA_CONTACT = {
    /** Legal + general inbox (terms, privacy, public footers) */
    info: INFO,
    /** Customer support / payment help mailtos */
    support: INFO,
    /** Sales / enterprise mailto */
    sales: INFO,
    /** Ops / lead delivery (function routes by kind; inbox stays info@) */
    ops: INFO,

    sendMailUrl: SEND_MAIL_URL,
    sendMail: sendMail,

    mailto: function (kind, subject) {
      var addr = this[kind] || this.info;
      var href = 'mailto:' + addr;
      if (subject) href += '?subject=' + encodeURIComponent(subject);
      return href;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
