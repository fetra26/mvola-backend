# MVola Backend — PCM IOUC 2026

## Déploiement sur Railway

### 1. Uploader sur GitHub
- Créez un repo GitHub nommé `mvola-backend`
- Uploadez les 2 fichiers : `server.js` et `package.json`

### 2. Déployer sur Railway
- Allez sur railway.app
- "New Project" → "Deploy from GitHub repo"
- Sélectionnez `mvola-backend`
- Railway détecte automatiquement Node.js et déploie

### 3. Variables d'environnement (Railway → Variables)
```
MVOLA_CONSUMER_KEY=v5yDnONFo1OCd5uSi_Nsfeo_Xxsa
MVOLA_CONSUMER_SECRET=dXkRKEcUZl3gNzw1YLqhOw42wd8a
MVOLA_MERCHANT_NUMBER=0343500003
MVOLA_COMPANY_NAME=PCM IOUC
MVOLA_ENV=sandbox
```

### 4. Obtenir l'URL publique
Railway génère une URL comme : https://mvola-backend-production.up.railway.app
Copiez cette URL et donnez-la à Claude pour l'intégrer dans index.html

## Endpoints
- POST /pay — Initier un paiement
- GET /status/:id — Vérifier le statut
- PUT /callback — Webhook MVola
- GET / — Health check
