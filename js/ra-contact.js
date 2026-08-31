/**
 * RegAnchor public & ops contact surface — single source of truth.
 *
 * Outbound mail: POST to the deployed Supabase Edge Function `send-mail`
 * (no JWT, no client API keys). From is locked server-side to
 * RegAnchor <info@reganchor.com>. Pass only `kind` + form fields —
 * never a From address or an arbitrary ops To.
 */
(function (global) {
  var INFO = 'info@reganchor.com';
  var SEND_MAIL_URL =
    'https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/send-mail';

  /**
   * POST { kind, ...payload } to send-mail.
   * Resolves with the JSON body ({ ok, id } or { error }).
   * Rejects on network failure or non-OK HTTP with an Error whose
   * message is the server error string when available.
   */
  function sendMail(kind, payload) {
    var body = Object.assign({}, payload || {}, { kind: kind });
    return fetch(SEND_MAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
