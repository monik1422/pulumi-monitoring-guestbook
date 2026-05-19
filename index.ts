import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * ---------------------------------------------------------
 * CONFIGURATION
 * ---------------------------------------------------------
 */

const config = new pulumi.Config();

const grafanaAdminPassword =
    config.requireSecret("grafanaAdminPassword");

const monitoringNamespaceName = "monitoring";
const guestbookNamespace = "default";

/**
 * ---------------------------------------------------------
 * MONITORING NAMESPACE
 * ---------------------------------------------------------
 */

const monitoringNamespace = new k8s.core.v1.Namespace(
    "monitoring-namespace",
    {
        metadata: {
            name: monitoringNamespaceName,
        },
    }
);

/**
 * ---------------------------------------------------------
 * REDIS MASTER
 * ---------------------------------------------------------
 */

const redisMasterLabels = {
    app: "redis",
    role: "master",
};

const redisMasterDeployment = new k8s.apps.v1.Deployment(
    "redis-master",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "redis-master",
        },
        spec: {
            replicas: 1,
            selector: {
                matchLabels: redisMasterLabels,
            },
            template: {
                metadata: {
                    labels: redisMasterLabels,
                },
                spec: {
                    containers: [
                        {
                            name: "master",
                            image: "redis:6.2",
                            ports: [
                                {
                                    containerPort: 6379,
                                },
                            ],
                        },
                    ],
                },
            },
        },
    }
);

const redisMasterService = new k8s.core.v1.Service(
    "redis-master-service",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "redis-master",
            labels: redisMasterLabels,
        },
        spec: {
            selector: redisMasterLabels,
            ports: [
                {
                    port: 6379,
                    targetPort: 6379,
                },
            ],
        },
    },
    { dependsOn: redisMasterDeployment }
);

/**
 * ---------------------------------------------------------
 * REDIS REPLICA
 * ---------------------------------------------------------
 */

const redisReplicaLabels = {
    app: "redis",
    role: "replica",
};

const redisReplicaDeployment = new k8s.apps.v1.Deployment(
    "redis-replica",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "redis-replica",
        },
        spec: {
            replicas: 1,
            selector: {
                matchLabels: redisReplicaLabels,
            },
            template: {
                metadata: {
                    labels: redisReplicaLabels,
                },
                spec: {
                    containers: [
                        {
                            name: "replica",
                            image: "gcr.io/google_samples/gb-redisslave:v3",
                            env: [
                                {
                                    name: "GET_HOSTS_FROM",
                                    value: "dns",
                                },
                            ],
                            ports: [
                                {
                                    containerPort: 6379,
                                },
                            ],
                        },
                    ],
                },
            },
        },
    }
);

const redisReplicaService = new k8s.core.v1.Service(
    "redis-replica-service",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "redis-replica",
            labels: redisReplicaLabels,
        },
        spec: {
            selector: redisReplicaLabels,
            ports: [
                {
                    port: 6379,
                    targetPort: 6379,
                },
            ],
        },
    },
    { dependsOn: redisReplicaDeployment }
);

/**
 * ---------------------------------------------------------
 * GUESTBOOK FRONTEND
 * ---------------------------------------------------------
 */

const guestbookLabels = {
    app: "guestbook",
    tier: "frontend",
};

const guestbookDeployment = new k8s.apps.v1.Deployment(
    "guestbook-frontend",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "guestbook-frontend",
        },
        spec: {
            replicas: 2,
            selector: {
                matchLabels: guestbookLabels,
            },
            template: {
                metadata: {
                    labels: guestbookLabels,

                    annotations: {
                        "prometheus.io/scrape": "true",
                        "prometheus.io/port": "80",
                        "prometheus.io/path": "/",
                    },
                },
                spec: {
                    containers: [
                        {
                            name: "php-redis",
                            image:
                                "gcr.io/google-samples/gb-frontend:v5",

                            env: [
                                {
                                    name: "GET_HOSTS_FROM",
                                    value: "dns",
                                },
                            ],

                            ports: [
                                {
                                    containerPort: 80,
                                    name: "http",
                                },
                            ],

                            resources: {
                                requests: {
                                    cpu: "100m",
                                    memory: "128Mi",
                                },
                                limits: {
                                    cpu: "250m",
                                    memory: "256Mi",
                                },
                            },
                        },
                    ],
                },
            },
        },
    },
    {
        dependsOn: [
            redisMasterDeployment,
            redisReplicaDeployment,
        ],
    }
);

const guestbookService = new k8s.core.v1.Service(
    "guestbook-service",
    {
        metadata: {
            namespace: guestbookNamespace,
            name: "guestbook",
            labels: guestbookLabels,

            annotations: {
                "prometheus.io/scrape": "true",
                "prometheus.io/port": "80",
                "prometheus.io/path": "/",
            },
        },

        spec: {
            type: "LoadBalancer",

            selector: guestbookLabels,

            ports: [
                {
                    port: 80,
                    targetPort: "http",
                    protocol: "TCP",
                    name: "http",
                },
            ],
        },
    },
    { dependsOn: guestbookDeployment }
);

/**
 * ---------------------------------------------------------
 * KUBE PROMETHEUS STACK
 * ---------------------------------------------------------
 */

const kubePrometheusStack = new k8s.helm.v3.Chart(
    "kube-prometheus-stack",
    {
        chart: "kube-prometheus-stack",
        version: "45.7.1",
        namespace: monitoringNamespace.metadata.name,
        fetchOpts: {
            repo: "https://prometheus-community.github.io/helm-charts",
        },
        values: {
            prometheusOperator: {
                enabled: true,
            },
            grafana: {
                enabled: true,
                adminUser: "admin",
                adminPassword: grafanaAdminPassword,
                service: {
                    type: "LoadBalancer",
                    port: 80,
                    targetPort: 3000,
                },
            },
            prometheus: {
                enabled: true,
                prometheusSpec: {
                    serviceMonitorSelectorNilUsesHelmValues: false,
                },
            },
            alertmanager: {
                enabled: true,
            },
            kubeStateMetrics: {
                enabled: true,
            },
            nodeExporter: {
                enabled: true,
            },
        },
    },
    {
        dependsOn: monitoringNamespace,
    }
);

/**
 * ---------------------------------------------------------
 * SERVICE MONITOR
 * ---------------------------------------------------------
 */

const guestbookServiceMonitor =
    new k8s.apiextensions.CustomResource(
        "guestbook-servicemonitor",
        {
            apiVersion: "monitoring.coreos.com/v1",

            kind: "ServiceMonitor",

            metadata: {
                name: "guestbook-servicemonitor",

                namespace: monitoringNamespaceName,

                labels: {
                    release: "kube-prometheus-stack",
                },
            },

            spec: {
                selector: {
                    matchLabels: guestbookLabels,
                },

                namespaceSelector: {
                    matchNames: [guestbookNamespace],
                },

                endpoints: [
                    {
                        port: "http",

                        path: "/",

                        interval: "15s",
                    },
                ],
            },
        },
        {
            dependsOn: [
                kubePrometheusStack,
                guestbookService,
            ],
        }
    );

/**
 * ---------------------------------------------------------
 * GRAFANA RESOURCES
 * ---------------------------------------------------------
 */

const grafanaService = kubePrometheusStack.getResource(
    "v1/Service",
    "monitoring/kube-prometheus-stack-grafana"
);

const grafanaSecret = kubePrometheusStack.getResource(
    "v1/Secret",
    "monitoring/kube-prometheus-stack-grafana"
);

/**
 * ---------------------------------------------------------
 * BUILD GRAFANA URL
 * ---------------------------------------------------------
 */

const grafanaUrl = grafanaService.status.apply(
    (status) => {
        const ingress =
            status?.loadBalancer?.ingress?.[0];

        if (!ingress) {
            return "pending";
        }

        const host = ingress.hostname || ingress.ip;

        return `http://${host}`;
    }
);

/**
 * ---------------------------------------------------------
 * EXTRACT GRAFANA PASSWORD
 * ---------------------------------------------------------
 */

const grafanaPasswordOutput =
    grafanaSecret.data.apply((data) => {
        if (!data) {
            return pulumi.secret("unknown");
        }

        const passwordKey = Object.keys(data).find(
            (k) =>
                k.toLowerCase().includes("admin")
        );

        if (!passwordKey) {
            return pulumi.secret("unknown");
        }

        return pulumi.secret(
            Buffer.from(
                data[passwordKey],
                "base64"
            ).toString()
        );
    });

/**
 * ---------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------
 */

export const guestbookUrl =
    guestbookService.status.apply((status) => {
        const ingress =
            status?.loadBalancer?.ingress?.[0];

        if (!ingress) {
            return "pending";
        }

        const host = ingress.hostname || ingress.ip;

        return `http://${host}`;
    });

export const grafanaAccessUrl = grafanaUrl;

export const grafanaUsername = "admin";

export const grafanaPassword =
    grafanaPasswordOutput;

export const monitoringNamespaceOutput =
    monitoringNamespaceName;

export const guestbookNamespaceOutput =
    guestbookNamespace;
