# Peerbot Deployment Guide

This guide explains how to deploy Peerbot to your existing Kubernetes cluster using GitHub Actions and GitHub Container Registry.

## Prerequisites

- An existing Kubernetes cluster
- `kubectl` configured to access your cluster
- GitHub repository with Actions enabled
- Helm 3.x installed locally (for testing)

## GitHub Secrets Configuration

Configure the following secrets in your GitHub repository (Settings → Secrets and variables → Actions):

### Required Kubernetes Secret
- `KUBE_CONFIG`: Base64-encoded kubeconfig file for your cluster
  ```bash
  # Generate the base64-encoded kubeconfig
  cat ~/.kube/config | base64
  ```

### Required Application Secrets
- `GH_CLIENT_ID`: GitHub OAuth App Client ID
- `GH_CLIENT_SECRET`: GitHub OAuth App Client Secret
- `ENCRYPTION_KEY`: 32-character encryption key for data at rest
- `SLACK_BOT_TOKEN`: Slack Bot User OAuth Token (xoxb-...)
- `SLACK_APP_TOKEN`: Slack App-Level Token (xapp-...)
- `SLACK_SIGNING_SECRET`: Slack Signing Secret

## Deployment Process

### 1. GitHub Container Registry

The workflow automatically builds and pushes Docker images to GitHub Container Registry (ghcr.io). Images are tagged with:
- `ghcr.io/{owner}/peerbot/claude-dispatcher:{sha}`
- `ghcr.io/{owner}/peerbot/claude-worker:{sha}`
- `ghcr.io/{owner}/peerbot/claude-orchestrator:{sha}`

### 2. Helm Deployment

The deployment uses Helm to install/upgrade the Peerbot chart with:
- Namespace: `peerbot`
- Release name: `peerbot`
- Values file: `charts/peerbot/values-community.yaml`

### 3. Triggering Deployment

Deploy via GitHub Actions:

1. **Manual Deployment:**
   - Go to Actions tab in your repository
   - Select "Deploy to Kubernetes" workflow
   - Click "Run workflow"
   - Select branch to deploy (default: main)

2. **Automated Deployment:**
   - Push to main branch (if configured)
   - Or trigger via repository dispatch event

### 4. Customization

#### Update Ingress Settings
Edit `charts/peerbot/values-community.yaml`:
```yaml
ingress:
  enabled: true
  className: "nginx"  # Your ingress controller
  hosts:
    - host: your-domain.com
      paths:
        - path: /slack
          pathType: Prefix
```

#### Adjust Resource Limits
Modify resource requirements in `values-community.yaml` based on your cluster capacity:
```yaml
dispatcher:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
```

#### Storage Class
Update PostgreSQL storage class to match your cluster:
```yaml
postgresql:
  persistence:
    storageClass: "your-storage-class"  # Or leave empty for default
```

## Verification

After deployment, verify the installation:

```bash
# Check pods
kubectl get pods -n peerbot

# Check services
kubectl get svc -n peerbot

# View logs
kubectl logs -n peerbot -l app=peerbot-dispatcher

# Get ingress (if enabled)
kubectl get ingress -n peerbot
```

## Troubleshooting

### Common Issues

1. **ImagePullBackOff**: Ensure GitHub Container Registry permissions are correct
2. **Pending PVCs**: Check your storage class is available
3. **CrashLoopBackOff**: Check secrets are properly configured
4. **Ingress not working**: Verify ingress controller and class name

### Debug Commands

```bash
# Describe failing pod
kubectl describe pod -n peerbot <pod-name>

# Check events
kubectl get events -n peerbot --sort-by='.lastTimestamp'

# Helm status
helm status peerbot -n peerbot

# Helm values
helm get values peerbot -n peerbot
```

## Cleanup

To remove the deployment:

```bash
# Uninstall Helm release
helm uninstall peerbot -n peerbot

# Delete namespace (optional)
kubectl delete namespace peerbot
```