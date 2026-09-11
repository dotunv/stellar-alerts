output "network_id" {
  description = "GCP VPC network ID"
  value       = google_compute_network.vpc.id
}

output "network_name" {
  description = "GCP VPC network name"
  value       = google_compute_network.vpc.name
}

output "subnet_id" {
  description = "GCP Subnet ID"
  value       = google_compute_subnetwork.subnet.id
}

output "subnet_name" {
  description = "GCP Subnet name"
  value       = google_compute_subnetwork.subnet.name
}
