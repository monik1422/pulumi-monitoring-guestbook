# pulumi-monitoring-guestbook

Prerequisites

AWS account and aws CLI configured (aws configure).
An EKS cluster created and kubectl configured to talk to it. Example quick create with eksctl:
bash
eksctl create cluster --name guestbook-monitoring --region us-east-1 --nodegroup-name ng-small --node-type t3.small --nodes 1

Pulumi CLI installed and logged in.
Node.js and npm installed.
kubectl installed.
