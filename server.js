const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// MVola config
const CONSUMER_KEY    = process.env.MVOLA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MVOLA_CONSUMER_SECRET;
const MERCHANT_NUMBER = process.env.MVOLA_MERCHANT_NUMBER || '0341884930';
const COMPANY_NAME    = process.env.MVOLA_COMPANY_NAME || 'PCM IOUC';
const ENV             = process.env.MVOLA_ENV || 'sandbox';

const BASE_URL = ENV === 'production'
  ? 'https://api.mvola.mg'
  : 'https://devapi.mvola.mg';

// ── 1. Get OAuth Token ──
async function getToken() {
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.post(
    `${BASE_URL}/token`,
    'grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      }
    }
  );
  return res.data.access_token;
}

// ── 2. Initiate Payment ──
app.post('/api/mvola/pay', async (req, res) => {
  try {
    const { amount, customerMsisdn, description } = req.body;

    if (!amount || !customerMsisdn) {
      return res.status(400).json({ success: false, error: 'amount and customerMsisdn are required' });
    }

    const token = await getToken();

    // Format phone numbers (remove leading 0, add 261)
    const formatPhone = (num) => {
      const clean = String(num).replace(/\s/g, '').replace(/^\+261/, '').replace(/^261/, '').replace(/^0/, '');
      return '261' + clean;
    };

    const merchantMsisdn = formatPhone(MERCHANT_NUMBER);
    const payerMsisdn    = formatPhone(customerMsisdn);

    const correlationId  = 'PCM-' + Date.now();
    const transactionRef = 'TX' + Date.now();

    const requestDate = new Date().toISOString();

    const body = {
      amount: String(amount),
      currency: 'Ar',
      descriptionText: description || `Frais inscription ${COMPANY_NAME}`,
      requestingOrganisationTransactionReference: transactionRef,
      requestDate: requestDate,
      originalTransactionReference: transactionRef,
      debitParty: [{ key: 'msisdn', value: payerMsisdn }],
      creditParty: [{ key: 'msisdn', value: merchantMsisdn }],
      metadata: [
        { key: 'partnerName', value: COMPANY_NAME },
        { key: 'fc', value: 'USD' },
        { key: 'amountFc', value: '1' }
      ]
    };

    console.log('MVola request body:', JSON.stringify(body, null, 2));
    console.log('Merchant MSISDN:', merchantMsisdn);
    console.log('Payer MSISDN:', payerMsisdn);

    const response = await axios.post(
      `${BASE_URL}/mvola/mm/transactions/type/merchantpay/1.0.0/`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': '1.0',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-CorrelationID': correlationId,
          'UserLanguage': 'MG',
          'UserAccountIdentifier': `msisdn;${merchantMsisdn}`,
          'partnerName': COMPANY_NAME,
          'X-Callback-URL': ''
        }
      }
    );

    return res.json({
      success: true,
      serverCorrelationId: response.data.serverCorrelationId || correlationId,
      transactionReference: transactionRef,
      status: response.data.status || 'pending',
      data: response.data
    });

  } catch (err) {
    const errData = err.response?.data;
    const errMsg = errData?.message || errData?.error || errData?.errorDescription || JSON.stringify(errData) || err.message;
    console.error('MVola error status:', err.response?.status);
    console.error('MVola error data:', JSON.stringify(errData, null, 2));
    return res.status(500).json({
      success: false,
      error: errMsg,
      details: errData
    });
  }
});

// ── 3. Health check ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'MVola Backend PCM IOUC', env: ENV }));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT} [${ENV}]`));
