# Deploying Bodhika Server to Google Cloud Run

## Prerequisites

1. Google Cloud Project with billing enabled
2. Google Cloud SDK (`gcloud`) installed and configured
3. Docker installed locally (for testing)
4. Required APIs enabled:
   - Cloud Run API
   - Cloud Build API
   - Container Registry API

## Environment Variables

Before deploying, ensure you have the following environment variables:

- `GEMINI_API_KEY`: Your Google AI API key (required)
- `MODEL_NAME`: Gemini model name (default: gemini-2.0-flash-exp)
- `VOICE_NAME`: Voice for audio output (default: Orus)
- `SESSION_TIMEOUT`: Session timeout in ms (default: 900000)
- `MAX_SESSIONS`: Maximum concurrent sessions (default: 100)

## Deployment Steps

### 1. Initial Setup

```bash
# Set your project ID
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### 2. Build and Test Locally

```bash
# Build Docker image locally
docker build -t bodhika-server .

# Test locally (replace YOUR_API_KEY with actual key)
docker run -p 8080:8080 \
  -e GEMINI_API_KEY=YOUR_API_KEY \
  -e PORT=8080 \
  bodhika-server
```

### 3. Deploy to Cloud Run

#### Option A: Using Cloud Build (Recommended)

```bash
# Submit build and deploy
gcloud builds submit --config=cloudbuild.yaml
```

#### Option B: Manual Deployment

```bash
# Build and push image
docker build -t gcr.io/$PROJECT_ID/bodhika-server .
docker push gcr.io/$PROJECT_ID/bodhika-server

# Deploy to Cloud Run
gcloud run deploy bodhika-server \
  --image gcr.io/$PROJECT_ID/bodhika-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 900 \
  --max-instances 10 \
  --min-instances 0 \
  --set-env-vars NODE_ENV=production
```

### 4. Set Environment Variables (CRITICAL)

**IMPORTANT**: The server will start without `GEMINI_API_KEY` but won't handle WebSocket connections properly. You MUST set the API key immediately after deployment:

```bash
# Set the API key (REQUIRED - replace YOUR_API_KEY with actual key)
gcloud run services update bodhika-server \
  --region us-central1 \
  --update-env-vars GEMINI_API_KEY=YOUR_API_KEY \
  --update-env-vars MODEL_NAME=gemini-2.0-flash-exp \
  --update-env-vars VOICE_NAME=Orus \
  --update-env-vars SESSION_TIMEOUT=900000 \
  --update-env-vars MAX_SESSIONS=100
```

**Note**: The server now includes a health check endpoint at `/health` that allows it to start even without the API key, preventing deployment failures. However, WebSocket connections will fail until the API key is configured.

### 5. Get Service URL

```bash
gcloud run services describe bodhika-server \
  --region us-central1 \
  --format 'value(status.url)'
```

## WebSocket Connection

Cloud Run supports WebSocket connections. Your ESP32 devices can connect using:

```
wss://your-service-url.run.app?device_id=YOUR_DEVICE_ID
```

Note: Replace `ws://` with `wss://` for secure WebSocket connections.

## Important Considerations

### 1. Cold Starts
Cloud Run may experience cold starts. Consider:
- Setting minimum instances to 1 for reduced latency
- Using Cloud Run CPU allocation: `--cpu-always-allocated`

### 2. WebSocket Timeouts
Cloud Run has a maximum request timeout of 60 minutes. For long-running WebSocket connections:
- Implement reconnection logic in ESP32 clients
- Use heartbeat/ping-pong messages

### 3. Scaling
- Adjust `--max-instances` based on expected concurrent connections
- Each instance can handle multiple WebSocket connections

### 4. Costs
- Cloud Run charges for:
  - CPU and memory usage during request processing
  - Minimum instances (if configured)
  - Network egress

### 5. Security
- Consider implementing authentication for production
- Use Secret Manager for sensitive environment variables:

```bash
# Create secret
echo -n "YOUR_API_KEY" | gcloud secrets create gemini-api-key --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member=serviceAccount:YOUR_SERVICE_ACCOUNT \
  --role=roles/secretmanager.secretAccessor

# Reference in deployment
gcloud run services update bodhika-server \
  --region us-central1 \
  --update-secrets=GEMINI_API_KEY=gemini-api-key:latest
```

## Monitoring

### View Logs
```bash
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=bodhika-server" \
  --limit 50 --format json
```

### View Metrics
Access Cloud Run metrics in the Google Cloud Console:
- Request count
- Request latency
- WebSocket connections
- Error rate

## Troubleshooting

### Common Issues

1. **WebSocket connection fails**
   - Ensure you're using `wss://` protocol
   - Check Cloud Run service is allowing unauthenticated access
   - Verify WebSocket upgrade headers are being sent

2. **High latency**
   - Increase minimum instances
   - Use `--cpu-always-allocated` flag
   - Consider deploying to a region closer to users

3. **Memory issues**
   - Increase memory allocation
   - Monitor memory usage in Cloud Console
   - Implement proper cleanup for inactive sessions

4. **API key not working**
   - Verify environment variable is set correctly
   - Check Secret Manager permissions if using secrets
   - Ensure API key has necessary permissions

## Cleanup

To avoid charges, clean up resources when not needed:

```bash
# Delete Cloud Run service
gcloud run services delete bodhika-server --region us-central1

# Delete container images
gcloud container images delete gcr.io/$PROJECT_ID/bodhika-server

# Delete secrets (if created)
gcloud secrets delete gemini-api-key
```