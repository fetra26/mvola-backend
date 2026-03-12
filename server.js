const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

/* ══════════════════════════════════════════════
   🔑 CONFIG MVola Sandbox
   Ces valeurs seront dans les variables d'env Railway
══════════════════════════════════════════════ */
const CONSUMER_KEY    = process.env.MVOLA_CONSUMER_KEY    || 'v5yDnONFo1OCd5uSi_Nsfeo_Xxsa';
const CONSUMER_SECRET = process.env.MVOLA_CONSUMER_SECRET || 'dXkRKEcUZl3gNzw1YLqhOw42wd8a';
const MERCHANT_NUMBER = process.env.MVOLA_MERCHANT_NUMBER || '0343500003'; // numéro sandbox MVola
const COMPANY_NAME    = process.env.MVOLA_COMPANY_NAME    || 'PCM IOUC';
const ENVIRONMENT     = process.env.MVOLA_ENV             || 'sandbox'; // 'sandbox' ou 'production'

const BASE_URL  = ENVIRONMENT === 'production'
  ? 'https://api.mvola.mg'
  : 'https://devapi.mvola.mg';
const AUTH_URL  = ENVIRONMENT === 'production'
  ? 'https://api.mvola.mg/token'
  : 'https://devapi.mvola.mg/token';

/* ══════════════════════════════════════════════
   🔐 ÉTAPE 1 — Obtenir un Access Token OAuth2
══════════════════════════════════════════════ */
async function getAccessToken() {
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: 'grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE'
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

/* ══════════════════════════════════════════════
   💳 ROUTE — Initier un paiement MVola
   POST /pay
   Body: { amount, customerNumber, description, transactionRef, callbackUrl }
══════════════════════════════════════════════ */
app.post('/pay', async (req, res) => {
  try {
    const { amount, customerNumber, description, transactionRef } = req.body;

    if (!amount || !customerNumber || !transactionRef) {
      return res.status(400).json({ error: 'Paramètres manquants: amount, customerNumber, transactionRef requis' });
    }

    // Nettoyer le numéro (enlever +261, espaces)
    const cleanNumber = customerNumber.replace(/\D/g, '').replace(/^261/, '0');

    const token = await getAccessToken();
    const correlationId = 'PCM-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    const requestDate   = new Date().toISOString().split('.')[0];

    const payload = {
      amount: String(amount),
      currency: 'Ar',
      descriptionText: description || 'Inscription PCM IOUC 2026',
      requestingOrganisationTransactionReference: transactionRef,
      requestDate: requestDate,
      originalTransactionReference: transactionRef,
      debitParty: [{ key: 'msisdn', value: cleanNumber }],
      creditParty: [{ key: 'msisdn', value: MERCHANT_NUMBER }],
      metadata: [
        { key: 'partnerName', value: COMPANY_NAME },
        { key: 'fc',         value: 'Ar' },
        { key: 'amountFc',   value: String(amount) }
      ]
    };

    const mvolaRes = await fetch(
      `${BASE_URL}/mvola/mm/transactions/type/merchantpay/1.0.0/`,
      {
        method: 'POST',
        headers: {
          'Authorization':              `Bearer ${token}`,
          'Version':                     '1.0',
          'X-CorrelationID':             correlationId,
          'UserLanguage':                'MG',
          'UserAccountIdentifier':       `msisdn;${MERCHANT_NUMBER}`,
          'partnerName':                 COMPANY_NAME,
          'Content-Type':               'application/json',
          'Cache-Control':              'no-cache'
        },
        body: JSON.stringify(payload)
      }
    );

    const mvolaData = await mvolaRes.json();
    console.log('MVola response:', JSON.stringify(mvolaData));

    if (mvolaRes.status === 202 || mvolaData.serverCorrelationId) {
      // ✅ Paiement initié — le client reçoit une notification USSD sur son téléphone
      return res.json({
        success: true,
        serverCorrelationId: mvolaData.serverCorrelationId,
        status: mvolaData.status,
        correlationId: correlationId,
        message: 'Paiement initié. Le client va recevoir une confirmation sur son téléphone.'
      });
    } else {
      return res.status(400).json({ success: false, error: mvolaData });
    }

  } catch (err) {
    console.error('Erreur:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════════
   🔍 ROUTE — Vérifier le statut d'un paiement
   GET /status/:serverCorrelationId
══════════════════════════════════════════════ */
app.get('/status/:serverCorrelationId', async (req, res) => {
  try {
    const { serverCorrelationId } = req.params;
    const token = await getAccessToken();
    const correlationId = 'PCM-CHECK-' + Date.now();

    const mvolaRes = await fetch(
      `${BASE_URL}/mvola/mm/transactions/type/merchantpay/1.0.0/status/${serverCorrelationId}`,
      {
        method: 'GET',
        headers: {
          'Authorization':         `Bearer ${token}`,
          'Version':                '1.0',
          'X-CorrelationID':        correlationId,
          'UserLanguage':           'MG',
          'UserAccountIdentifier':  `msisdn;${MERCHANT_NUMBER}`,
          'partnerName':            COMPANY_NAME,
          'Cache-Control':         'no-cache'
        }
      }
    );

    const data = await mvolaRes.json();
    console.log('Status check:', JSON.stringify(data));

    // status: 'pending' | 'completed' | 'failed'
    return res.json({
      success: true,
      status: data.status,
      transactionId: data.objectReference,
      raw: data
    });

  } catch (err) {
    console.error('Erreur status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════════
   📡 ROUTE — Callback MVola (webhook)
   PUT /callback
══════════════════════════════════════════════ */
app.put('/callback', (req, res) => {
  console.log('📡 MVola Callback reçu:', JSON.stringify(req.body));
  // Ici on pourrait mettre à jour Firestore
  res.status(200).json({ received: true });
});

/* ══════════════════════════════════════════════
   ❤️ Health check
══════════════════════════════════════════════ */
app.get('/', (req, res) => {
  res.json({
    status: '✅ MVola Backend PCM IOUC opérationnel',
    environment: ENVIRONMENT,
    version: '1.0.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur MVola démarré sur port ${PORT} — mode: ${ENVIRONMENT}`);
});
