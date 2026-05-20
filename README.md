🚀 Kubernetes Guestbook Monitoring Project (Pulumi + EKS)

This project extends the classic Kubernetes Guestbook application by adding full observability using Prometheus and Grafana, deployed using Pulumi (TypeScript) on an AWS EKS cluster.

It demonstrates how to:
Deploy a multi-tier Kubernetes application
Install monitoring stack using Helm (kube-prometheus-stack)
Configure Prometheus scraping using ServiceMonitor
Visualize metrics in Grafana dashboards
Expose services using AWS LoadBalancer (ALB / ELB)

📦 Architecture Overview

<img width="1536" height="1024" alt="Copilot_20260520_012828" src="https://github.com/user-attachments/assets/af83f863-bbec-44bc-97a6-39ac5bb7c930" />


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
pulumi-monitoring-guestbook/
│
├── Pulumi.yaml
├── Pulumi.dev.yaml
├── package.json
├── servicemonitor.yaml
├── index.ts
├── README.md

⚙️ Prerequisites
Install:
Node.js (>= 18)
Pulumi CLI
AWS CLI configured
kubectl
AWS EKS cluster already created

<img width="1367" height="637" alt="image" src="https://github.com/user-attachments/assets/6c52d4b9-55a3-4e53-ba7d-20e46ce23426" />

Verify:
kubectl get nodes
pulumi version
aws sts get-caller-identity

🚀 Deployment Steps
1. Clone and install
git clone https://github.com/pulumi/examples.git
cd C:\Users\monik\examples\kubernetes-ts-guestbook\components
npm install

2. Configure Pulumi Stack
pulumi stack init dev

3. Set Kubernetes context:
pulumi config set kubernetes:context arn:aws:eks:us-east-1:110588987466:cluster/sre-guestbook

Set Grafana admin password:
pulumi config set --secret grafanaAdminPassword admin123

4. Deploy Infrastructure
pulumi up

5. Confirm Pulumi state
pulumi stack output


    OUTPUT                     VALUE
    grafanaAccessUrl           http://a4d972159612e429894bee08090f7a1e-942827012.us-east-1.elb.amazonaws.com
    grafanaPassword            [secret]
    grafanaUsername            admin
    guestbookNamespaceOutput   default
    guestbookUrl               http://a1a48a4c72115444b8099a12b80645ac-1227882136.us-east-1.elb.amazonaws.com
    monitoringNamespaceOutput  monitoring

Confirm deployment:
kubectl get pods -A

<img width="1427" height="571" alt="image" src="https://github.com/user-attachments/assets/bbc7e0e3-0db0-46b7-8dfa-30310db374dc" />


Expected namespaces:
default → Guestbook + Redis
monitoring → Prometheus + Grafana
🌐 Access Applications
🎯 Guestbook Application

Access:
http://a1a48a4c72115444b8099a12b80645ac-1227882136.us-east-1.elb.amazonaws.com

<img width="1486" height="365" alt="image" src="https://github.com/user-attachments/assets/2c1d2d4c-52c4-46fc-a287-e8cbe45681b0" />


Get LoadBalancer URL:
kubectl get svc


📊 Grafana Dashboard

Get service:
kubectl get svc -n monitoring

Find:
kube-prometheus-stack-grafana

Open:
http://a4d972159612e429894bee08090f7a1e-942827012.us-east-1.elb.amazonaws.com

Login:
Username: admin
Password: admin123 (or configured secret)

<img width="1902" height="940" alt="image" src="https://github.com/user-attachments/assets/223b96a8-2d91-4e5e-b5a2-d5d3ca6a5914" />


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


📊 Verification Steps
1. Check Prometheus Targets
http://localhost:9090/targets

Expected:
guestbook-servicemonitor → UP

<img width="1915" height="957" alt="image" src="https://github.com/user-attachments/assets/d6cdb197-97a3-4963-8b42-0f7ebf9c57f1" />

2. Check Metrics in Prometheus
Query Guestbook metrics
Pod CPU usage -->
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default"}[2m]))

Pod memory usage --> 
container_memory_working_set_bytes{namespace="default"}

Deployment replicas ready -->
kube_deployment_status_replicas_ready{deployment="guestbook-frontend"}

3. Check Grafana Dashboards
Navigate:
Dashboards → Browse

Look for:
Kubernetes / Compute Resources
Node Exporter Full
Cluster Monitoring

<img width="1907" height="952" alt="image" src="https://github.com/user-attachments/assets/6e5022db-d50a-4056-91c5-c8f031ff05c5" />


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

This project demonstrates a production-grade Kubernetes observability setup using:
Infrastructure as Code (Pulumi)
Cloud-native monitoring (Prometheus + Grafana)
Kubernetes-native service discovery (ServiceMonitor)

This setup is fully reproducible on any EKS cluster and can be extended with:
Alertmanager alerts
Custom Grafana dashboards
HPA autoscaling based on metrics
