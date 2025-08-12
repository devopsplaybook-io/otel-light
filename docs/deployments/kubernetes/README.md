# Deploying with Kubernetes.

In the [otel-light] directory, you will find an example of deployment using Yaml files (with Kustomize)

To Launch the application in Kubenetes:

```bash
git clone https://github.com/DidierHoarau/otel-light
cd otel-light/docs/deployments/kubernetes/otel-light
kubectl kustomize . | kubectl apply -f -
```
