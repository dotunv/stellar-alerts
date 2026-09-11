resource "google_container_cluster" "primary" {
  name     = "${var.environment}-stellar-alerts-gke"
  location = var.region
  project  = var.project_id

  network    = var.network_name
  subnetwork = var.subnet_name

  remove_default_node_pool = true
  initial_node_count       = 1

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  deletion_protection = var.environment == "prod"
}

resource "google_container_node_pool" "primary_nodes" {
  name       = "${var.environment}-stellar-alerts-pool"
  location   = var.region
  cluster    = google_container_cluster.primary.name
  project    = var.project_id
  node_count = var.node_count

  node_config {
    preemptible  = var.environment != "prod"
    machine_type = var.machine_type

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = {
      environment = var.environment
      app         = "stellar-alerts"
    }
  }
}
