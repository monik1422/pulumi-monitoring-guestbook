import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// Config
const config = new pulumi.Config();
const grafanaAdminPassword = config.requireSecret("grafanaAdminPassword");
const monitoringNamespace = "monitoring";
const guestbookNamespace = "default";

// 1. Create monitoring namespace
const monitoringNs = new k8s.core.v1.Namespace("monitoring-namespace", {
  metadata: { name: monitoringNamespace },
});

// 2. Deploy Guestbook application resources (frontend + redis + backend)
// Minimal guestbook frontend Deployment and Service exposing /metrics on port 80
const guestbookLabels = { app: "guestbook-frontend" };

const guestbookDeployment = new k8s.apps.v1.Deployment("guestbook-frontend-deploy", {
  metadata: { namespace: guestbookNamespace, name: "guestbook-frontend" },
  spec: {
    replicas: 1,
    selector: { matchLabels: guestbookLabels },
    template: {
      metadata: { labels: guestbookLabels },
      spec: {
        containers: [{
          name: "frontend",
          image: "k8s.gcr.io/echoserver:1.10", // simple image; replace with actual guestbook frontend if desired
          ports: [{ containerPort: 8080, name: "http" }],
          // Expose a basic metrics endpoint using a sidecar or instrumented app in real scenario.
        }],
      },
    },
  },
});

// Service for frontend with named port "http"
const guestbookService = new k8s.core.v1.Service("guestbook-frontend-svc", {
  metadata: {
    namespace: guestbookNamespace,
    name: "guestbook-frontend",
    labels: guestbookLabels,
    annotations: {
      // optional fallback if ServiceMonitor not used
      "prometheus.io/scrape": "true",
      "prometheus.io/port": "8080",
      "prometheus.io/path": "/metrics"
    }
  },
  spec: {
    selector: guestbookLabels,
    ports: [{ port: 80, targetPort: "http", name: "http" }],
    type: "ClusterIP",
  },
}, { dependsOn: guestbookDeployment });

// 3. Install kube-prometheus-stack Helm chart
const kubeProm = new k8s.helm.v3.Chart("kube-prom-stack", {
  chart: "kube-prometheus-stack",
  fetchOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
  version: "45.6.0", // pin a stable version; adjust if needed
  namespace: monitoringNs.metadata.name,
  values: {
    grafana: {
      enabled: true,
      adminUser: "admin",
      adminPassword: grafanaAdminPassword,
      service: { type: "LoadBalancer", port: 80, targetPort: 3000 },
      ingress: { enabled: false }
    },
    prometheus: {
      prometheusSpec: {
        serviceMonitorSelectorNilUsesHelmValues: false
      }
    },
    kubeStateMetrics: { enabled: true },
    nodeExporter: { enabled: true }
  }
}, { dependsOn: monitoringNs });

// 4. Create ServiceMonitor to scrape Guestbook service
// Use CustomResource because ServiceMonitor is a CRD
const serviceMonitor = new k8s.apiextensions.CustomResource("guestbook-servicemonitor", {
  apiVersion: "monitoring.coreos.com/v1",
  kind: "ServiceMonitor",
  metadata: {
    name: "guestbook-servicemonitor",
    namespace: monitoringNamespace,
    labels: { release: "kube-prom-stack" }
  },
  spec: {
    selector: { matchLabels: guestbookLabels },
    namespaceSelector: { matchNames: [guestbookNamespace] },
    endpoints: [{
      port: "http",
      path: "/metrics",
      interval: "15s"
    }]
  }
}, { dependsOn: [kubeProm, guestbookService] });

// 5. Read Grafana service and secret created by the chart and export access details
// Chart resource names vary by chart version. The chart typically creates a Service with label app.kubernetes.io/name=grafana
const grafanaService = k8s.core.v1.Service.get("grafana-service",
  pulumi.interpolate`${monitoringNamespace}/kube-prometheus-stack-grafana`,
  { async: true }
);

// Fallback: if the above name does not exist in your chart version, you can find the service with kubectl -n monitoring get svc -l app.kubernetes.io/name=grafana

// Grafana secret name created by chart is often kube-prometheus-stack-grafana
const grafanaSecret = k8s.core.v1.Secret.get("grafana-secret",
  pulumi.interpolate`${monitoringNamespace}/kube-prometheus-stack-grafana`,
  { async: true }
);

// Helper to build URL from service status
const grafanaUrl = grafanaService.status.apply(s => {
  const lb = s?.loadBalancer?.ingress?.[0];
  if (!lb) return "pending";
  const host = lb.hostname ?? lb.ip;
  return `http://${host}`;
});

// Extract admin password from secret if available
const grafanaAdminUser = pulumi.output("admin");
const grafanaAdminPasswordOut = grafanaSecret.data.apply(d => {
  if (!d) return pulumi.secret("unknown");
  // chart secret key may be "admin-password" or "grafana-admin-password"
  const key = Object.keys(d).find(k => k.toLowerCase().includes("admin"));
  if (!key) return pulumi.secret("unknown");
  return pulumi.secret(Buffer.from(d[key], "base64").toString());
});

// Exports
export const grafanaAccessUrl = grafanaUrl;
export const grafanaUser = grafanaAdminUser;
export const grafanaPassword = grafanaAdminPasswordOut;
export const monitoringNamespaceOut = monitoringNamespace;
export const guestbookNamespaceOut = guestbookNamespace;
