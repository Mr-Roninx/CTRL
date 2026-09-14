import { Router, Request, Response } from 'express';

export const sdkRouter = Router();

const CTRL_SDK_JS = `/**
 * CTRL Autonomous Payment Recovery - Zero-Code Client Interceptor (v1.0.0)
 * https://github.com/Mr-Roninx/CTRL
 */
(function() {
  if (window.__CTRL_INITIALIZED__) return;
  window.__CTRL_INITIALIZED__ = true;

  function findCurrentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('ctrl.js') !== -1) {
        return scripts[i];
      }
    }
    return null;
  }

  var currentScript = findCurrentScript();
  var apiKey = currentScript ? currentScript.getAttribute('data-api-key') : (window.__CTRL_API_KEY__ || null);
  
  function resolveApiUrl() {
    if (window.__CTRL_API_URL__) return window.__CTRL_API_URL__.replace(/\\/+$/, '');
    if (currentScript && currentScript.getAttribute('data-api-url')) {
      return currentScript.getAttribute('data-api-url').replace(/\\/+$/, '');
    }
    if (currentScript && currentScript.src) {
      try {
        var parsed = new URL(currentScript.src);
        return parsed.origin;
      } catch(e) {
        return currentScript.src.replace(/\\/(sdk\\/)?ctrl\\.js(\\?.*)?$/i, '');
      }
    }
    return window.location.origin;
  }

  var apiUrl = resolveApiUrl();
  var isConnected = false;
  var tenantId = null;

  // 1. Connection Handshake & Periodic Heartbeat
  function sendPing(callback) {
    if (!apiKey) {
      console.warn('⚠️ [CTRL] data-api-key attribute missing on <script src=".../ctrl.js"> tag.');
      if (typeof callback === 'function') callback(false, { error: 'Missing API key' });
      return;
    }

    var pingEndpoint = apiUrl + '/v1/events/ping';
    var payload = {
      app_origin: window.location.origin,
      app_url: window.location.href,
      app_name: document.title || window.location.hostname,
      sdk_version: '1.0.0',
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      metadata: {
        title: document.title,
        referrer: document.referrer,
        screen: window.screen ? (window.screen.width + 'x' + window.screen.height) : 'unknown'
      }
    };

    try {
      fetch(pingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(payload)
      }).then(function(res) {
        return res.json().then(function(data) {
          if (res.ok && data.connected) {
            isConnected = true;
            tenantId = data.tenant_id;
            console.log('🟢 [CTRL] Web app connection verified with Control Plane (Tenant: ' + data.tenant_id + ').');
            if (typeof callback === 'function') callback(true, data);
          } else {
            console.warn('⚠️ [CTRL] Connection ping rejected (' + res.status + '):', data.error || data.message);
            if (typeof callback === 'function') callback(false, data);
          }
        });
      }).catch(function(err) {
        console.warn('⚠️ [CTRL] Connection handshake error:', err.message);
        if (typeof callback === 'function') callback(false, { error: err.message });
      });
    } catch(e) {}
  }

  // 2. Dispatch Payment Failure
  function reportPaymentFailure(details) {
    if (!apiKey) {
      console.warn('⚠️ [CTRL] Cannot report payment failure: data-api-key not provided.');
      return Promise.reject(new Error('Missing API key'));
    }
    var endpoint = apiUrl + '/v1/events';
    var amount = details.amount_paise || details.amount;
    var parsedAmount = Number(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      parsedAmount = 149900; // default to ₹1,499 if unspecified
    }

    var payload = {
      event_id: 'evt_client_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      source: 'CLIENT_SDK',
      provider: 'razorpay',
      environment: apiKey.indexOf('ctrl_live_') === 0 || apiKey.indexOf('ul_live_') === 0 ? 'live' : 'test',
      payment_id: details.payment_id || ('pay_fe_' + Date.now()),
      order_id: details.order_id || undefined,
      amount_paise: Math.round(parsedAmount),
      currency: details.currency || 'INR',
      status: 'failed',
      failure_code: details.error_code || 'BAD_REQUEST_PAYMENT_FAILED',
      failure_description: details.error_description || 'Payment failed on client checkout',
      customer_reference: details.customer_id || details.email || details.contact || 'cust_anonymous',
      customer_email: details.email || undefined,
      customer_phone: details.contact || undefined,
      occurred_at: new Date().toISOString(),
      metadata: details.metadata || { url: window.location.href, title: document.title }
    };

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function(res) {
      return res.json().then(function(data) {
        if (res.ok) {
          console.log('🛡️ [CTRL] Payment failure captured & processed (Opportunity: ' + (data.opportunity_id || 'created') + ').');
          try {
            window.dispatchEvent(new CustomEvent('ctrl:failure_intercepted', { detail: data }));
          } catch(e) {}
        } else {
          console.warn('⚠️ [CTRL] Gateway rejected failure event (' + res.status + '):', data.error || data.message || data.details);
        }
        return data;
      });
    }).catch(function(e) {
      console.warn('⚠️ [CTRL] Background dispatch error:', e.message);
      throw e;
    });
  }

  // 3. Dispatch Payment Success (Reconciliation)
  function reportPaymentSuccess(details) {
    if (!apiKey) return;
    var endpoint = apiUrl + '/v1/events';
    var payload = {
      event_id: 'evt_succ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      source: 'CLIENT_SDK',
      provider: 'razorpay',
      environment: apiKey.indexOf('ctrl_live_') === 0 || apiKey.indexOf('ul_live_') === 0 ? 'live' : 'test',
      payment_id: details.payment_id || details.razorpay_payment_id,
      order_id: details.order_id || details.razorpay_order_id,
      payment_link_id: details.payment_link_id,
      amount_paise: Math.round(Number(details.amount_paise || details.amount) || 10000),
      currency: details.currency || 'INR',
      status: 'paid',
      customer_reference: details.customer_id || details.email || details.contact || 'cust_anonymous',
      customer_email: details.email || undefined,
      customer_phone: details.contact || undefined,
      occurred_at: new Date().toISOString(),
      metadata: { url: window.location.href, title: document.title }
    };

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function() {});
    } catch(e) {}
  }

  // 4. Wrap window.Razorpay checkout
  function wrapRazorpay() {
    if (!window.Razorpay || window.Razorpay.__ctrl_wrapped__) return;
    
    var OriginalRazorpay = window.Razorpay;
    function CtrlRazorpay(options) {
      options = options || {};

      // Wrap success handler
      var originalHandler = options.handler;
      options.handler = function(response) {
        try {
          reportPaymentSuccess({
            payment_id: response ? response.razorpay_payment_id : undefined,
            order_id: response ? response.razorpay_order_id : options.order_id,
            amount_paise: options.amount,
            currency: options.currency,
            email: options.prefill ? options.prefill.email : null,
            contact: options.prefill ? options.prefill.contact : null,
          });
        } catch(e) {}
        if (typeof originalHandler === 'function') {
          return originalHandler.apply(this, arguments);
        }
      };

      var instance = new OriginalRazorpay(options);

      // Attach failure listener
      if (typeof instance.on === 'function') {
        instance.on('payment.failed', function(response) {
          try {
            var err = response.error || {};
            var meta = err.metadata || {};
            reportPaymentFailure({
              payment_id: meta.payment_id || response.razorpay_payment_id,
              order_id: meta.order_id || options.order_id,
              amount_paise: options.amount,
              currency: options.currency || 'INR',
              error_code: err.code || 'BAD_REQUEST_PAYMENT_FAILED',
              error_description: err.description || err.reason || 'Payment authorization failed',
              error_source: err.source,
              error_step: err.step,
              error_reason: err.reason,
              email: options.prefill ? options.prefill.email : null,
              contact: options.prefill ? options.prefill.contact : null,
              customer_id: options.customer_id,
              metadata: {
                notes: options.notes,
                page_url: window.location.href,
                error_step: err.step,
                error_source: err.source
              }
            });
          } catch(e) {}
        });
      }

      return instance;
    }

    CtrlRazorpay.prototype = OriginalRazorpay.prototype;
    CtrlRazorpay.__ctrl_wrapped__ = true;
    window.Razorpay = CtrlRazorpay;
    console.log('🛡️ [CTRL] Autonomous Payment Interceptor active on page.');
  }

  // Initial connection ping
  sendPing();

  // Periodic heartbeat every 45s
  setInterval(function() {
    sendPing();
  }, 45000);

  // Hook Razorpay instance
  if (window.Razorpay) {
    wrapRazorpay();
  } else {
    var checkInterval = setInterval(function() {
      if (window.Razorpay) {
        wrapRazorpay();
        clearInterval(checkInterval);
      }
    }, 200);
    setTimeout(function() { clearInterval(checkInterval); }, 60000);
  }

  // Public Developer Interface
  var ctrlInterface = {
    version: '1.0.0',
    reportFailure: reportPaymentFailure,
    reportSuccess: reportPaymentSuccess,
    ping: sendPing,
    status: function() {
      return {
        initialized: true,
        connected: isConnected,
        tenantId: tenantId,
        apiUrl: apiUrl,
        hasApiKey: Boolean(apiKey),
        origin: window.location.origin,
      };
    },
    init: function(opts) {
      if (opts && opts.apiKey) apiKey = opts.apiKey;
      if (opts && opts.apiUrl) apiUrl = opts.apiUrl.replace(/\\/+$/, '');
      sendPing();
      wrapRazorpay();
    }
  };

  window.Ctrl = ctrlInterface;
})();
`;

const serveSdkScript = (req: Request, res: Response) => {
  const apiKey = (req.query.api_key as string) || '';
  const apiUrl = (req.query.api_url as string) || '';

  let scriptContent = CTRL_SDK_JS;
  let prefix = '';
  if (apiKey) {
    prefix += `window.__CTRL_API_KEY__ = ${JSON.stringify(apiKey)};\n`;
  }
  if (apiUrl) {
    prefix += `window.__CTRL_API_URL__ = ${JSON.stringify(apiUrl)};\n`;
  }
  scriptContent = prefix + scriptContent;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(scriptContent);
};

sdkRouter.get('/ctrl.js', serveSdkScript);
sdkRouter.get('/', serveSdkScript);

sdkRouter.get('/download', (req: Request, res: Response) => {
  const apiKey = (req.query.api_key as string) || '';
  const apiUrl = (req.query.api_url as string) || '';

  let scriptContent = CTRL_SDK_JS;
  let prefix = `/**
 * CTRL Autonomous Payment Interceptor - Pre-Configured Standalone File
 * Drop this file into your merchant website root folder.
 * Add to your checkout page: <script src="./ctrl.js"></script>
 */\n`;
  if (apiKey) {
    prefix += `window.__CTRL_API_KEY__ = ${JSON.stringify(apiKey)};\n`;
  }
  if (apiUrl) {
    prefix += `window.__CTRL_API_URL__ = ${JSON.stringify(apiUrl)};\n`;
  }
  scriptContent = prefix + scriptContent;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ctrl.js"');
  res.send(scriptContent);
});
