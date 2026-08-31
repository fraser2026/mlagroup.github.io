/**
 * RegAnchor public & ops contact surface — single source of truth.
 *
 * Outbound mail is sent by third parties configured outside this repo:
 *   • EmailJS  (https://dashboard.emailjs.com) — browser SDK, template HTML/branding
 *       (demo modal, contact form, portal alerts, admin/enterprise notify)
 *   • FormSubmit (https://formsubmit.co) — diagnostic lead ping; contact fallback
 *       (must re-confirm new address)
 *
 * Changing RA_CONTACT.ops requires:
 *   1. Mailbox exists (or forwards) at that address
 *   2. FormSubmit re-confirmation email approved for that address
 *   3. EmailJS templates updated: {{to_email}}, from-name RegAnchor (not mlagroup.co.uk),
 *      reply-to / logo / footer → RegAnchor / reganchor.com
 */
(function (global) {
  var INFO = 'info@reganchor.com';

  global.RA_CONTACT = {
    /** Legal + general inbox (terms, privacy, public footers) */
    info: INFO,
    /** Customer support / payment help mailtos */
    support: INFO,
    /** Sales / enterprise mailto */
    sales: INFO,
    /**
     * Where FormSubmit and enterprise lead emails are delivered.
     * Prefer a real inbox you check; aliases (ops@ / fraser@) can replace later.
     */
    ops: INFO,

    emailjs: {
      publicKey: 'vxitc5LFJHMfNcmUL',
      /** Client post-diagnostic summary (goes to prospect) */
      clientService: 'service_amfeqty',
      clientTemplate: 'template_xczn8bt',
      /** Alerts, admin support replies, enterprise notify (server/human style) */
      opsService: 'service_umdte26',
      opsTemplate: 'template_o6h9et7'
    },

    formSubmitUrl: function () {
      return 'https://formsubmit.co/' + this.ops;
    },

    mailto: function (kind, subject) {
      var addr = this[kind] || this.info;
      var href = 'mailto:' + addr;
      if (subject) href += '?subject=' + encodeURIComponent(subject);
      return href;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
