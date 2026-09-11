variable "environment" {
  description = "Target deployment environment"
  type        = string
  default     = "dev"
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "network_id" {
  description = "VPC network ID for private services connection"
  type        = string
}

variable "tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "stellar_alerts"
}

variable "db_username" {
  description = "Database user"
  type        = string
  default     = "alerts_admin"
}

variable "db_password" {
  description = "Database user password"
  type        = string
  sensitive   = true
}
