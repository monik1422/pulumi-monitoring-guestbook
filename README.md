🚀 Kubernetes Guestbook Monitoring Project (Pulumi + EKS)

This project extends the classic Kubernetes Guestbook application by adding full observability using Prometheus and Grafana, deployed using Pulumi (TypeScript) on an AWS EKS cluster.

It demonstrates how to:

Deploy a multi-tier Kubernetes application
Install monitoring stack using Helm (kube-prometheus-stack)
Configure Prometheus scraping using ServiceMonitor
Visualize metrics in Grafana dashboards
Expose services using AWS LoadBalancer (ALB / ELB)


📦 Architecture Overview

User → AWS LoadBalancer (Guestbook Frontend)
                |
                v
        Guestbook Frontend
                |
        ---------------------
        |                   |
     Redis Master       Redis Replica

Monitoring Stack (Namespace: monitoring)
------------------------------------------------
Prometheus Operator
Prometheus Server
Grafana
Node Exporter
Kube State Metrics
ServiceMonitor → Guestbook scraping

🛠️ Tech Stack
Kubernetes (EKS)
Pulumi (TypeScript)
Helm Charts
Prometheus
Grafana
AWS LoadBalancer (ELB)
Docker images (Guestbook + sample metrics app)

📁 Project Structure
components/
 ├── index.ts        # Pulumi infrastructure code
 ├── package.json
 ├── tsconfig.json


⚙️ Prerequisites
Install:
Node.js (>= 18)
Pulumi CLI
AWS CLI configured
kubectl
EKS cluster already created

Verify:
kubectl get nodes
pulumi version
aws sts get-caller-identity

🚀 Deployment Steps
1️⃣ Configure Pulumi Stack
pulumi stack init dev

Set Kubernetes context:
pulumi config set kubernetes:context <your-eks-cluster-name>

Set Grafana admin password:
pulumi config set --secret grafanaAdminPassword admin123

2️⃣ Deploy Infrastructure
pulumi up

Confirm deployment:
kubectl get pods -A

Expected namespaces:
default → Guestbook + Redis
monitoring → Prometheus + Grafana
🌐 Access Applications
🎯 Guestbook Application

<img width="1486" height="365" alt="image" src="https://github.com/user-attachments/assets/2c1d2d4c-52c4-46fc-a287-e8cbe45681b0" />


Get LoadBalancer URL:
kubectl get svc

Access:
http://<EXTERNAL-LOADBALANCER>
📊 Grafana Dashboard

Get service:
kubectl get svc -n monitoring

Find:
kube-prometheus-stack-grafana

Open:
http://<EXTERNAL-IP>

Login:
Username: admin
Password: admin123 (or configured secret)

<img width="1902" height="956" alt="image" src="https://github.com/user-attachments/assets/b39ee098-cd8c-46b9-8459-7e3c376b0118" />


📈 Prometheus UI
Port-forward:
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090

Open:
http://localhost:9090

<img width="1911" height="960" alt="image" src="https://github.com/user-attachments/assets/16f3733a-3e8b-4985-9f91-ae69b88ee38f" />


📡 Monitoring Setup
🔍 ServiceMonitor Configuration

A ServiceMonitor is used to allow Prometheus to automatically discover and scrape Kubernetes services.

endpoints:
  - port: http
    path: /metrics
    interval: 15s

It targets:
Guestbook frontend service
Namespace: default
⚠️ Important Fix Applied

Initial issue:
❌ Prometheus was scraping HTML endpoints
❌ Result: "INVALID is not a valid start token"

Root cause:
Guestbook app did NOT expose /metrics

Fix applied:
✔ Replaced container with metrics-enabled app
✔ Ensured /metrics endpoint exists
✔ Corrected ServiceMonitor path

📊 Verification Steps
1. Check Prometheus Targets
http://localhost:9090/targets

Expected:
guestbook-servicemonitor → UP

2. Check Metrics in Prometheus

Run query:
up

or:

rate(http_requests_total[1m])

3. Check Grafana Dashboards
Navigate:
Dashboards → Browse

Look for:

Kubernetes / Compute Resources
Node Exporter Full
Cluster Monitoring

🚨 Challenges Faced & Solutions
❌ 1. Helm Chart Installation Issues
Problem:
Prometheus CRDs not installed
Operator logs showed missing resources

Solution:
Used stable Helm chart version
Recreated monitoring namespace
Ensured proper dependency order

❌ 2. Pulumi State Drift
Problem:
Resources existed in Pulumi state but not in cluster

Error:
serviceaccounts not found

Solution:
pulumi refresh
pulumi up

❌ 3. TypeScript Errors in Pulumi
Problem:
Invalid option skipAwait

Solution:
Removed unsupported Helm options

❌ 4. Prometheus Scraping Invalid Endpoint
Problem:
"INVALID" is not a valid start token

Root Cause:
Scraping HTML endpoint instead of /metrics

Solution:
Used metrics-enabled container image
Fixed ServiceMonitor path

❌ 5. LoadBalancer Delay in AWS
Problem:
Grafana external IP was pending

Solution:
Waited for ELB provisioning (2–5 mins)

📌 Key Learnings
Prometheus requires valid /metrics endpoint
ServiceMonitor is preferred over annotations
Helm + Pulumi requires careful state management
CRD ordering is critical in EKS
Monitoring stack must be deployed before scraping targets

🎯 Final Outcome
✔ Guestbook deployed on AWS EKS
✔ Redis backend running
✔ Prometheus installed via Helm
✔ Grafana exposed via LoadBalancer
✔ ServiceMonitor scraping configured
✔ Metrics successfully collected
✔ Full observability pipeline working

🏁 Conclusion
This project demonstrates a production-grade Kubernetes observability setup using:
Infrastructure as Code (Pulumi)
Cloud-native monitoring (Prometheus + Grafana)
Kubernetes-native service discovery (ServiceMonitor)

This setup is fully reproducible on any EKS cluster and can be extended with:
Alertmanager alerts
Custom Grafana dashboards
HPA autoscaling based on metrics
