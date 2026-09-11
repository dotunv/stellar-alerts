output "aws_vpc_id" {
  description = "AWS VPC ID (if target_cloud = aws)"
  value       = var.target_cloud == "aws" ? module.aws_vpc[0].vpc_id : null
}

output "aws_rds_endpoint" {
  description = "AWS RDS PostgreSQL endpoint (if target_cloud = aws)"
  value       = var.target_cloud == "aws" ? module.aws_rds[0].endpoint : null
}

output "aws_eks_cluster_name" {
  description = "AWS EKS cluster name (if target_cloud = aws)"
  value       = var.target_cloud == "aws" ? module.aws_eks[0].cluster_name : null
}

output "gcp_network_id" {
  description = "GCP VPC Network ID (if target_cloud = gcp)"
  value       = var.target_cloud == "gcp" ? module.gcp_vpc[0].network_id : null
}

output "gcp_sql_ip" {
  description = "GCP Cloud SQL Private IP (if target_cloud = gcp)"
  value       = var.target_cloud == "gcp" ? module.gcp_sql[0].private_ip_address : null
}

output "gcp_gke_cluster_name" {
  description = "GCP GKE cluster name (if target_cloud = gcp)"
  value       = var.target_cloud == "gcp" ? module.gcp_gke[0].cluster_name : null
}
