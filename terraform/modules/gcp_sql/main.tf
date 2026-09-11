resource "google_sql_database_instance" "main" {
  name             = "${var.environment}-stellar-alerts-db"
  database_version = "POSTGRES_16"
  region           = var.region
  project          = var.project_id

  settings {
    tier = var.tier

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
    }

    backup_configuration {
      enabled = true
    }
  }

  deletion_protection = var.environment == "prod"
}

resource "google_sql_database" "database" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
  project  = var.project_id
}

resource "google_sql_user" "users" {
  name     = var.db_username
  instance = google_sql_database_instance.main.name
  password = var.db_password
  project  = var.project_id
}
