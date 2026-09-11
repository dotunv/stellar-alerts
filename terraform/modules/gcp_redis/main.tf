resource "google_redis_instance" "cache" {
  name           = "${var.environment}-stellar-alerts-redis"
  tier           = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.memory_size_gb
  region         = var.region
  project        = var.project_id

  authorized_network = var.network_id

  redis_version     = "REDIS_7_0"
  display_name      = "${var.environment} Stellar Alerts Redis"
  connect_mode      = "PRIVATE_SERVICE_ACCESS"
}
