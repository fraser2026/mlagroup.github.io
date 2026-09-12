/**
 * Soft cutover helper toward app.reganchor.com (Worker live).
 * Opt-IN until hard cutover:
 *   - ?app=1 on portal.html, or
 *   - localStorage.setItem('ra_use_app','1')
 * Opt out anytime: ?legacy=1 or localStorage.removeItem('ra_use_app')
 * When ready for hard cutover, flip DEFAULT_TO_APP to true (see docs/APP-CUTOVER.md / docs/PARITY.md).
 *
 * App hosts a same-origin copy at /legacy/portal.html for functional parity.
 * Opt-in redirect still sends users to React routes where ports exist.
 */
(function () {
  var DEFAULT_TO_APP = false
  try {
    var params = new URLSearchParams(window.location.search)
    if (params.get('legacy') === '1') return
    var host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') return
    if (host === 'app.reganchor.com') return

    var optIn = params.get('app') === '1' || localStorage.getItem('ra_use_app') === '1'
    if (!DEFAULT_TO_APP && !optIn) return
    if (host !== 'reganchor.com' && host !== 'www.reganchor.com' && !/\.github\.io$/i.test(host)) return

    var target = 'https://app.reganchor.com'
    var path = '/portal'
    var hash = String(window.location.hash || '').replace(/^#/, '')
    if (params.get('mcp_oauth') === '1') {
      path = '/oauth/consent'
    } else if (hash.indexOf('registry-detail-') === 0) {
      path = '/registry/' + hash.slice('registry-detail-'.length)
    } else if (hash.indexOf('registry') === 0) {
      path = '/registry'
    } else if (hash.indexOf('control-detail-') === 0) {
      path = '/controls/' + hash.slice('control-detail-'.length)
    } else if (hash.indexOf('controls') === 0) {
      path = '/controls'
    } else if (hash.indexOf('policy-detail-') === 0) {
      path = '/policies/' + hash.slice('policy-detail-'.length)
    } else if (hash.indexOf('policies') === 0) {
      path = '/policies'
    } else if (hash.indexOf('integrations') === 0 || hash.indexOf('mcp-') === 0) {
      path = '/integrations'
      var hq = hash.indexOf('?')
      if (hq >= 0) {
        var hparams = new URLSearchParams(hash.slice(hq + 1))
        var code = hparams.get('code')
        if (code && !params.get('code') && !params.get('mcp_code')) params.set('code', code)
      }
    } else if (hash.indexOf('org') === 0) {
      path = '/organisation'
    } else if (hash.indexOf('users') === 0) {
      path = '/users'
    } else if (hash.indexOf('billing') === 0) {
      path = '/billing'
    } else if (hash.indexOf('plans') === 0) {
      path = '/plans'
    } else if (hash.indexOf('alerts') === 0) {
      path = '/alerts'
    } else if (hash.indexOf('reports') === 0) {
      path = '/reports'
    } else if (hash.indexOf('settings') === 0) {
      path = '/settings'
    } else if (hash.indexOf('dashboard') === 0 || !hash) {
      path = '/portal'
    }
    var qs = params.toString()
    window.location.replace(target + path + (qs ? '?' + qs : ''))
  } catch (e) {
    /* stay on legacy portal */
  }
})()
