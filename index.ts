import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const config = new pulumi.Config();
const grafanaAdminPassword  = config.requireSecret("grafanaAdminPassword");
const monitoringNamespaceName = "monitoring";
const guestbookNamespace      = "default";

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING NAMESPACE
// ─────────────────────────────────────────────────────────────────────────────

const monitoringNamespace = new k8s.core.v1.Namespace("monitoring-namespace", {
    metadata: { name: monitoringNamespaceName },
});

// ─────────────────────────────────────────────────────────────────────────────
// REDIS MASTER
// ─────────────────────────────────────────────────────────────────────────────

const redisMasterLabels = { app: "redis", role: "master" };

const redisMasterDeployment = new k8s.apps.v1.Deployment("redis-master", {
    metadata: { namespace: guestbookNamespace, name: "redis-master" },
    spec: {
        replicas: 1,
        selector: { matchLabels: redisMasterLabels },
        template: {
            metadata: {
                labels: redisMasterLabels,
                // FIX 1: No scrape annotations on Redis — it serves no HTTP metrics endpoint
            },
            spec: {
                containers: [{
                    name:  "master",
                    image: "redis:6.2",
                    ports: [{ containerPort: 6379 }],
                }],
            },
        },
    },
});

const redisMasterService = new k8s.core.v1.Service("redis-master-service", {
    metadata: {
        namespace: guestbookNamespace,
        name:      "redis-master",
        labels:    redisMasterLabels,
    },
    spec: {
        selector: redisMasterLabels,
        ports: [{ port: 6379, targetPort: 6379 }],
    },
}, { dependsOn: redisMasterDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// REDIS REPLICA
// ─────────────────────────────────────────────────────────────────────────────

const redisReplicaLabels = { app: "redis", role: "replica" };

const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    metadata: { namespace: guestbookNamespace, name: "redis-replica" },
    spec: {
        replicas: 1,
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: {
                labels: redisReplicaLabels,
                // FIX 1: No scrape annotations on Redis — it has no HTTP metrics endpoint
            },
            spec: {
                containers: [{
                    name:  "replica",
                    image: "gcr.io/google_samples/gb-redisslave:v3",
                    env:   [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ containerPort: 6379 }],
                }],
            },
        },
    },
});

const redisReplicaService = new k8s.core.v1.Service("redis-replica-service", {
    metadata: {
        namespace: guestbookNamespace,
        name:      "redis-replica",
        labels:    redisReplicaLabels,
    },
    spec: {
        selector: redisReplicaLabels,
        ports: [{ port: 6379, targetPort: 6379 }],
    },
}, { dependsOn: redisReplicaDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// GUESTBOOK FRONTEND
// The app itself has no /metrics endpoint.
// Metrics come from kube-state-metrics (pod CPU/mem/restarts)
// which is already deployed by kube-prometheus-stack.
// FIX 1: Removed prometheus.io annotations — port 80 returns HTML, not metrics.
// ─────────────────────────────────────────────────────────────────────────────

const guestbookLabels = { app: "guestbook", tier: "frontend" };

const guestbookDeployment = new k8s.apps.v1.Deployment("guestbook-frontend", {
    metadata: { namespace: guestbookNamespace, name: "guestbook-frontend" },
    spec: {
        replicas: 2,
        selector: { matchLabels: guestbookLabels },
        template: {
            metadata: {
                labels: guestbookLabels,
                // FIX 1: annotations REMOVED — port 80 is HTML not /metrics.
                // Pod-level resource metrics come automatically from kube-state-metrics
                // and cAdvisor (node-exporter), both shipped by kube-prometheus-stack.
            },
            spec: {
                containers: [{
                    name:  "php-redis",
                    image: "gcr.io/google-samples/gb-frontend:v5",
                    env:   [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ containerPort: 80, name: "http" }],
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits:   { cpu: "250m", memory: "256Mi" },
                    },
                }],
            },
        },
    },
}, { dependsOn: [redisMasterDeployment, redisReplicaDeployment] });

const guestbookService = new k8s.core.v1.Service("guestbook-service", {
    metadata: {
        namespace: guestbookNamespace,
        name:      "guestbook",
        labels:    guestbookLabels,
        // FIX 1: annotations REMOVED — same reason as above
    },
    spec: {
        type:     "LoadBalancer",
        selector: guestbookLabels,
        ports: [{
            port:       80,
            targetPort: "http",
            protocol:   "TCP",
            name:       "http",
        }],
    },
}, { dependsOn: guestbookDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// KUBE PROMETHEUS STACK
//
// FIX 3 (EKS): Disable control-plane targets that are unreachable on EKS
//   - kubeEtcd, kubeScheduler, kubeControllerManager
//   These are managed by AWS and not exposed to worker nodes.
//   Leaving them enabled causes permanent "target unreachable" warnings.
//
// FIX 4: Using k8s.helm.v3.Release instead of deprecated helm.sh/v3:Chart
// ─────────────────────────────────────────────────────────────────────────────

const kubePrometheusStack = new k8s.helm.v3.Release("kube-prometheus-stack", {
    name:      "kube-prometheus-stack",
    chart:     "kube-prometheus-stack",
    version:   "45.7.1",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    values: {
        prometheusOperator: { enabled: true },

        grafana: {
            enabled:       true,
            adminUser:     "admin",
            adminPassword: grafanaAdminPassword,
            service: {
                type:       "LoadBalancer",
                port:       80,
                targetPort: 3000,
            },
        },

        prometheus: {
            enabled: true,
            prometheusSpec: {
                // Allow ServiceMonitors from all namespaces (covers "default")
                serviceMonitorSelectorNilUsesHelmValues:   false,
                podMonitorSelectorNilUsesHelmValues:       false,
                // Scrape pod annotations from any namespace
                additionalScrapeConfigs: [
                    {
                        job_name: "kubernetes-pods",
                        kubernetes_sd_configs: [{ role: "pod" }],
                        relabel_configs: [
                            {
                                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_scrape"],
                                action: "keep",
                                regex: "true",
                            },
                            {
                                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_path"],
                                action:       "replace",
                                target_label: "__metrics_path__",
                                regex:        "(.+)",
                            },
                            {
                                source_labels: [
                                    "__address__",
                                    "__meta_kubernetes_pod_annotation_prometheus_io_port",
                                ],
                                action:      "replace",
                                regex:       "([^:]+)(?::\\d+)?;(\\d+)",
                                replacement: "$1:$2",
                                target_label: "__address__",
                            },
                            {
                                action: "labelmap",
                                regex:  "__meta_kubernetes_pod_label_(.+)",
                            },
                            {
                                source_labels: ["__meta_kubernetes_namespace"],
                                action:       "replace",
                                target_label: "kubernetes_namespace",
                            },
                            {
                                source_labels: ["__meta_kubernetes_pod_name"],
                                action:       "replace",
                                target_label: "kubernetes_pod_name",
                            },
                        ],
                    },
                ],
            },
        },

        alertmanager: { enabled: true },

        // FIX 3 — Disable EKS-managed control plane targets (not reachable from workers)
        kubeEtcd: {
            enabled: false,  // etcd is internal to EKS control plane
        },
        kubeScheduler: {
            enabled: false,  // scheduler is internal to EKS control plane
        },
        kubeControllerManager: {
            enabled: false,  // controller-manager is internal to EKS control plane
        },
        // kubeProxy is also commonly disabled on EKS (kube-proxy metrics port blocked)
        kubeProxy: {
            enabled: false,
        },

        kubeStateMetrics: { enabled: true },
        nodeExporter:     { enabled: true },
    },
}, { dependsOn: monitoringNamespace });

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE MONITOR
// FIX 2: ServiceMonitor removed — the guestbook app has no /metrics endpoint.
//
// kube-state-metrics (already deployed above) automatically exposes:
//   kube_pod_status_phase, kube_pod_container_resource_requests,
//   kube_deployment_status_replicas_ready, etc. for the guestbook pods.
//
// These are the metrics you should use in Grafana for the guestbook.
// If you later add a real metrics endpoint (e.g. nginx-prometheus-exporter
// sidecar), re-add the ServiceMonitor pointing to that port.
// ─────────────────────────────────────────────────────────────────────────────

// (ServiceMonitor intentionally removed — see comment above)

// ─────────────────────────────────────────────────────────────────────────────
// GRAFANA DASHBOARD CONFIGMAP (stretch goal)
// Labelled grafana_dashboard=1 so Grafana's sidecar picks it up automatically.
// Uses kube-state-metrics queries that actually work on EKS.
// ─────────────────────────────────────────────────────────────────────────────

const guestbookDashboard = new k8s.core.v1.ConfigMap("guestbook-dashboard", {
    metadata: {
        name:      "guestbook-grafana-dashboard",
        namespace: monitoringNamespaceName,
        labels: {
            grafana_dashboard: "1",
        },
    },
    data: {
        "guestbook.json": JSON.stringify({
            title:         "Guestbook Application",
            uid:           "guestbook-v1",
            schemaVersion: 36,
            version:       1,
            refresh:       "30s",
            time:          { from: "now-1h", to: "now" },
            timezone:      "browser",
            templating: {
                list: [{
                    name:    "namespace",
                    type:    "query",
                    label:   "Namespace",
                    datasource: { type: "prometheus", uid: "prometheus" },
                    query:   "label_values(kube_pod_info, namespace)",
                    current: { value: "default", text: "default" },
                    refresh: 2,
                }],
            },
            panels: [
                {
                    id: 1, type: "stat", title: "Frontend replicas ready",
                    gridPos: { x: 0, y: 0, w: 6, h: 4 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `sum(kube_deployment_status_replicas_ready{namespace="$namespace", deployment="guestbook-frontend"})`,
                        refId: "A",
                    }],
                },
                {
                    id: 2, type: "stat", title: "Redis master replicas ready",
                    gridPos: { x: 6, y: 0, w: 6, h: 4 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `sum(kube_deployment_status_replicas_ready{namespace="$namespace", deployment="redis-master"})`,
                        refId: "A",
                    }],
                },
                {
                    id: 3, type: "stat", title: "Pods running",
                    gridPos: { x: 12, y: 0, w: 6, h: 4 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `count(kube_pod_status_phase{namespace="$namespace", phase="Running"})`,
                        refId: "A",
                    }],
                },
                {
                    id: 4, type: "stat", title: "Pod restarts (1h)",
                    gridPos: { x: 18, y: 0, w: 6, h: 4 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `sum(increase(kube_pod_container_status_restarts_total{namespace="$namespace"}[1h]))`,
                        refId: "A",
                    }],
                    fieldConfig: {
                        defaults: {
                            thresholds: {
                                mode: "absolute",
                                steps: [
                                    { color: "green", value: 0 },
                                    { color: "red",   value: 1 },
                                ],
                            },
                        },
                    },
                },
                {
                    id: 5, type: "timeseries", title: "CPU usage by container",
                    gridPos: { x: 0, y: 4, w: 12, h: 8 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `sum by (container) (rate(container_cpu_usage_seconds_total{namespace="$namespace", container!=""}[2m]))`,
                        legendFormat: "{{container}}",
                        refId: "A",
                    }],
                },
                {
                    id: 6, type: "timeseries", title: "Memory usage by container (MiB)",
                    gridPos: { x: 12, y: 4, w: 12, h: 8 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `sum by (container) (container_memory_working_set_bytes{namespace="$namespace", container!=""}) / 1024 / 1024`,
                        legendFormat: "{{container}}",
                        refId: "A",
                    }],
                },
                {
                    id: 7, type: "table", title: "Pod status",
                    gridPos: { x: 0, y: 12, w: 24, h: 6 },
                    datasource: { type: "prometheus", uid: "prometheus" },
                    targets: [{
                        expr: `kube_pod_info{namespace="$namespace"}`,
                        refId: "A",
                        instant: true,
                    }],
                    transformations: [{ id: "labelsToFields", options: {} }],
                },
            ],
        }),
    },
}, { dependsOn: kubePrometheusStack });

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVE GRAFANA SERVICE + SECRET
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const guestbookUrl = guestbookService.status.apply((status) => {
    const ing = status?.loadBalancer?.ingress?.[0];
    returning? `http://${ing.hostname ?? ing.ip}` : "pending";
});

export const grafanaAccessUrl    = "run: kubectl get svc -n monitoring kube-prometheus-stack-grafana";
export const grafanaUsername     = "admin";
export const grafanaPassword     = grafanaAdminPassword;
export const monitoringNamespaceOutput = monitoringNamespaceName;
export const guestbookNamespaceOutput  = guestbookNamespace;
