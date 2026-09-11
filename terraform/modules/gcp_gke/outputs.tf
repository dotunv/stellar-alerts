output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.primary.name
}

output "endpoint" {
  description = "GKE cluster control plane endpoint"
  value       = google_container_cluster.primary.endpoint
}

output "ca_certificate" {
  description = "Cluster CA certificate"
  value       = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
}
